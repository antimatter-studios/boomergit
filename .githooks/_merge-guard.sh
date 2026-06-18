#!/usr/bin/env bash
# merge-guard shared helpers. Sourced by the hooks; defines functions only and
# never exits the calling shell.
#
# Fail-open by design: a guard that blocks your work when GitHub/network/gh is
# unavailable is worse than the mistake it prevents. The ONE exception is the
# local merge-commit block (pre-merge-commit / pre-push) — that check is purely
# local, needs no network, and is always enforced.

# Echo the GitHub "owner/repo" slug for the origin remote, or nothing when the
# remote is missing or not on github.com.
mg_repo_slug() {
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 0
  case "$url" in
    *github.com[:/]*) ;;
    *) return 0 ;;
  esac
  url=${url%.git}
  url=${url#*github.com[:/]}
  printf '%s' "$url"
}

mg_have_gh() {
  command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1
}

# Echo the authenticated GitHub login, or nothing.
mg_login() {
  gh api user --jq '.login' 2>/dev/null
}

# Return 0 only if the authenticated user OWNS this account: it is their personal
# account, or an org where their membership role is "admin" (owner). We change
# settings only on accounts we own — never other people's orgs, even where we
# happen to have repo-admin. A new org you create matches automatically (you own
# it); orgs you don't own are skipped silently.
mg_user_owns() {
  local owner="$1" me role
  me=$(mg_login); [ -n "$me" ] || return 1
  [ "$owner" = "$me" ] && return 0
  role=$(gh api "user/memberships/orgs/$owner" --jq '.role' 2>/dev/null) || return 1
  [ "$role" = "admin" ]
}

# Read the remote's merge settings and, if merge commits are allowed, switch the
# repo to squash+rebase only — but only on accounts we own. Throttled by
# $MERGE_GUARD_TTL seconds (default 0 = check on every commit).
mg_heal_settings() {
  local slug ttl stamp now last owner allow
  slug=$(mg_repo_slug); [ -n "$slug" ] || return 0

  ttl=${MERGE_GUARD_TTL:-0}
  stamp="$(git rev-parse --git-dir 2>/dev/null)/merge-guard.checked"
  if [ "$ttl" -gt 0 ] && [ -f "$stamp" ]; then
    now=$(date +%s); last=$(date -r "$stamp" +%s 2>/dev/null || echo 0)
    [ $((now - last)) -lt "$ttl" ] && return 0
  fi

  mg_have_gh || {
    printf 'merge-guard: gh not installed/authed — skipping settings check for %s\n' "$slug" >&2
    return 0
  }

  # Never touch accounts we don't own. Local merge-commit blocks still apply.
  owner=${slug%%/*}
  if ! mg_user_owns "$owner"; then
    : > "$stamp" 2>/dev/null || true
    return 0
  fi

  allow=$(gh api "repos/$slug" --jq '.allow_merge_commit' 2>/dev/null) || {
    printf 'merge-guard: could not read settings for %s — skipping\n' "$slug" >&2
    return 0
  }

  if [ "$allow" = "true" ]; then
    printf 'merge-guard: %s allows merge commits — switching to squash+rebase only…\n' "$slug" >&2
    if gh api -X PATCH "repos/$slug" \
         -F allow_merge_commit=false \
         -F allow_squash_merge=true \
         -F allow_rebase_merge=true >/dev/null 2>&1; then
      printf 'merge-guard: %s fixed ✓\n' "$slug" >&2
    else
      printf 'merge-guard: PATCH failed for %s (need repo admin?) — commit not blocked\n' "$slug" >&2
    fi
  fi

  : > "$stamp" 2>/dev/null || true
  return 0
}
