import sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    content = f.read()

checks = [
    "'card.think.running'",
    "vi.mock('react-i18next'",
    "vi.mock('@lobehub/icons'",
    "vi.hoisted",
]
for c in checks:
    print(f"Has {c[:40]:40s}: {c in content}")

idx = content.find("vi.mock('@lobehub/icons'")
if idx >= 0:
    before = content[max(0,idx-80):idx]
    print(f"\n80 chars before @lobehub mock:")
    print(repr(before))
