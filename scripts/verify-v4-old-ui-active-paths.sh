#!/usr/bin/env bash
# Verify that Desktop/Web v4 do not route through the retired main workbench UI.
#
# Old utility components may still exist temporarily as migration material, tests,
# or type fixtures. The retired Chat/Prompt/Thread/IM hook files must stay
# deleted, and active app source must not import old workbench paths.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASSED=0
FAILED=0

pass_check() {
    PASSED=$((PASSED + 1))
    printf '\e[32m  PASS  %s\e[0m\n' "$1"
}

fail_check() {
    FAILED=$((FAILED + 1))
    printf '\e[31m  FAIL  %s\e[0m\n' "$1"
}

relative() {
    local path="$1"
    printf '%s' "${path#$REPO_ROOT/}"
}

echo ""
echo "=== v4 old UI active path boundary ==="

REMOVED_ACTIVE_FILES=(
    "app/desktop/src/config/viewRegistry.ts"
    "app/desktop/src/views/viewRegistry.tsx"
    "app/desktop/src/views/MainView.tsx"
    "app/desktop/src/views/IMView.tsx"
    "app/web/src/viewRegistryConfig.ts"
    "app/web/src/views/viewRegistry.tsx"
    "app/web/src/views/MainView.tsx"
    "app/web/src/views/IMView.tsx"
    "app/desktop/src/components/ChatView.tsx"
    "app/desktop/src/components/ChatView.module.css"
    "app/desktop/src/components/ChatView.types.ts"
    "app/desktop/src/components/PromptInput.tsx"
    "app/desktop/src/components/PromptInput.module.css"
    "app/desktop/src/components/ThreadPanel.tsx"
    "app/desktop/src/components/ThreadPanel.module.css"
    "app/desktop/src/hooks/useChatMessages.ts"
    "app/desktop/src/hooks/useIMChat.ts"
    "app/desktop/src/components/IM/IMBlockRenderer.tsx"
    "app/desktop/src/components/IM/IMBlockRenderer.module.css"
    "app/desktop/src/components/IM/IMMessageView.tsx"
    "app/desktop/src/components/IM/IMMessageView.module.css"
    "app/web/src/components/ChatView.tsx"
    "app/web/src/components/ChatView.module.css"
    "app/web/src/components/ChatView.types.ts"
    "app/web/src/components/PromptInput.tsx"
    "app/web/src/components/PromptInput.module.css"
    "app/web/src/components/ThreadPanel.tsx"
    "app/web/src/components/ThreadPanel.module.css"
    "app/web/src/components/RunDetail.tsx"
    "app/web/src/components/RunDetail.module.css"
    "app/web/src/components/ReplyPreviewBar.tsx"
    "app/web/src/components/ReplyPreviewBar.module.css"
    "app/web/src/hooks/useIMChat.ts"
    "app/web/src/components/IM/IMMessageView.tsx"
    "app/web/src/components/IM/IMMessageView.module.css"
)

for rel in "${REMOVED_ACTIVE_FILES[@]}"; do
    if [[ -f "$REPO_ROOT/$rel" ]]; then
        fail_check "$rel should not exist as an active v4 route entry"
    else
        pass_check "$rel remains removed"
    fi
done

# Check active source files for forbidden imports
FORBIDDEN_IMPORTS=(
    "@/components/ChatView|old ChatView import"
    "@/components/PromptInput|old PromptInput import"
    "@/components/RunDetail|old RunDetail import"
    "@/components/ThreadPanel|old ThreadPanel import"
    "@/components/IM/IMBlockRenderer|old IMBlockRenderer import"
    "@/hooks/useChatMessages|old useChatMessages import"
    "@/hooks/useIMChat|old useIMChat import"
    "@/components/ChatView.types|old ChatView.types import"
    "@/config/viewRegistry|@/viewRegistryConfig|@/views/viewRegistry|old viewRegistry import"
)

for entry in "${FORBIDDEN_IMPORTS[@]}"; do
    IFS='|' read -ra parts <<< "$entry"
    # Last element is the label, rest are patterns
    label="${parts[-1]}"
    unset 'parts[-1]'
    # Combine remaining as pattern
    combined=""
    for p in "${parts[@]}"; do
        if [[ -z "$combined" ]]; then
            combined="$p"
        else
            combined="${combined}|${p}"
        fi
    done

    hits=""
    desktop_hits="$(grep -rnE "$combined" "$REPO_ROOT/app/desktop/src" --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v '__tests__\|__e2e__\|\.test\.\|\.spec\.\|\.stories\.')" || true
    web_hits="$(grep -rnE "$combined" "$REPO_ROOT/app/web/src" --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v '__tests__\|__e2e__\|\.test\.\|\.spec\.\|\.stories\.')" || true
    hits="${desktop_hits}
${web_hits}"

    if [[ -n "$(echo "$hits" | grep -v '^$' || true)" ]]; then
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            f="$(echo "$line" | cut -d: -f1)"
            l="$(echo "$line" | cut -d: -f2)"
            fail_check "$label found in $(relative "$f"):$l"
        done <<< "$hits"
    else
        pass_check "$label absent from active Desktop/Web source"
    fi
done

echo ""
echo "========================================"
printf "  Passed: %d  |  Failed: %d\n" "$PASSED" "$FAILED"
echo "========================================"

if [[ "$FAILED" -ne 0 ]]; then
    exit 1
fi
