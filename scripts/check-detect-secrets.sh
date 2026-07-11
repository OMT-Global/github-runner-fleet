    #!/usr/bin/env bash
    set -euo pipefail

    mode="${1:-"--all-files"}"
    ignore_globs=("scripts/check-detect-secrets.sh")
    if [[ -f .detect-secrets-ignore ]]; then
      while IFS= read -r ignore_glob; do
        if [[ -z "$ignore_glob" ]]; then
          continue
        fi
        if [[ "${ignore_glob:0:1}" == "#" ]]; then
          continue
        fi
        ignore_globs+=("$ignore_glob")
      done < .detect-secrets-ignore
    fi

    should_skip_file() {
      local candidate="$1"
      local ignore_glob
      for ignore_glob in "${ignore_globs[@]}"; do
        case "$candidate" in
          $ignore_glob)
            return 0
            ;;
        esac
      done
      return 1
    }

    files=()
    if [[ "$mode" == "--staged" ]]; then
      while IFS= read -r -d '' file; do
        files+=("$file")
      done < <(git diff --cached --name-only --diff-filter=ACMR -z)
    else
      while IFS= read -r -d '' file; do
        files+=("$file")
      done < <(git ls-files -z)
    fi

    if [[ "${#files[@]}" -eq 0 ]]; then
      echo "No files to scan."
      exit 0
    fi

    patterns=(
      'ghp_'
      'github_pat_'
      'sk-live-'
      'sk-proj-'
      'AKIA[0-9A-Z]{16}'
      'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY'
      'ANTHROPIC_API_KEY='
      'OPENAI_API_KEY='
      'SUDO_PASS='
      'BW_SESSION='
    )

    tmp_file="$(mktemp)"
    trap 'rm -f "$tmp_file"' EXIT

    for file in "${files[@]}"; do
      if [[ ! -f "$file" ]] || should_skip_file "$file"; then
        continue
      fi
      printf '%s
' "$file" >>"$tmp_file"
    done

    failed=0
    while IFS= read -r file; do
      for pattern in "${patterns[@]}"; do
        if grep -E -n "$pattern" "$file" >/dev/null 2>&1; then
          echo "Potential secret pattern '$pattern' found in $file" >&2
          failed=1
        fi
      done
    done <"$tmp_file"

    exit "$failed"
