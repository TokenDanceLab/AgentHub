import sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    content = f.read()

# Remove block from 611 to 2485 (the broken vi.mock('react-i18next') + its imports)
content = content[:611] + content[2485:]

with open(sys.argv[1], 'w', encoding='utf-8') as f:
    f.write(content)
print('REMOVED')
print('Has react mock:', "vi.mock('react-i18next'" in content)
print('Has card.think:', "'card.think'" in content)
