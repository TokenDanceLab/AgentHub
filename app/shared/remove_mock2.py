import sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    content = f.read()

# Find the block precisely:
# From 'import { sharedWorkbenchResources } from' to the end of the vi.mock block + blank line
import_start = content.find("import { sharedWorkbenchResources } from '../i18n/workbench';")
# Find the closing }); of the react-i18next vi.mock
# The pattern is: });\n\nvi.mock('@lobehub/icons'
lobe_idx = content.find("vi.mock('@lobehub/icons'")
# Find the }); that closes the react-i18next mock (just before @lobehub mock)
mock_close = content.rfind("});", 0, lobe_idx)
# Include the newline after });
if content[mock_close+3] == '\n':
    mock_end = mock_close + 4  # include \n
else:
    mock_end = mock_close + 3

# Check the block looks right
print(f"Block: {import_start} to {mock_end}")
print(f"Before: {repr(content[import_start-30:import_start])}")
print(f"Block start: {repr(content[import_start:import_start+60])}")
print(f"Block end: {repr(content[mock_end-60:mock_end])}")
print(f"After: {repr(content[mock_end:mock_end+60])}")

if import_start < 0 or mock_end <= import_start:
    print("BAD BOUNDARIES")
    sys.exit(1)

content = content[:import_start] + content[mock_end:]
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    f.write(content)
print("DONE")
print("Has react mock:", "vi.mock('react-i18next'" in content)
print("Has sharedWorkbenchResources import:", "sharedWorkbenchResources" in content[:200])
