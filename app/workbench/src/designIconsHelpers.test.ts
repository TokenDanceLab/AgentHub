import { describe, expect, it } from 'vitest';
import {
  DESIGN_FILE_ICON_COLORS,
  DESIGN_FILE_ICON_RADIUS,
  DESIGN_FILE_ICON_SIZE,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DESIGN_NAV_ICON_SIZE,
  DESIGN_NAV_ICON_STROKE_WIDTH,
  getDesignFileIconColor,
  getDesignFileIconType,
  isDesignFileIconType,
  profileActionIconName,
  PROFILE_ACTION_ICON_RULES,
} from './designIconsHelpers';

describe('designIconsHelpers', () => {
  it('normalizes file icons through the design source rules', () => {
    expect(getDesignFileIconType(undefined, '.gitignore')).toBe('git');
    expect(getDesignFileIconType(undefined, 'src/workbench/RightInspector.tsx')).toBe('tsx');
    expect(getDesignFileIconType('md', 'src/workbench/RightInspector.tsx')).toBe('tsx');
    expect(getDesignFileIconType('sql', 'sqlite-migration-plan.md')).toBe('md');
    expect(getDesignFileIconType('markdown', 'README')).toBe('markdown');
    expect(getDesignFileIconType('unknown-kind', 'README.unknown')).toBe('file');
  });

  it('keeps file icon colors aligned to tokendance-design/desktop', () => {
    expect(getDesignFileIconColor('md')).toBe('var(--td-ink-muted)');
    expect(getDesignFileIconColor('css')).toBe('#1572b6');
    expect(getDesignFileIconColor('html')).toBe('#e34f26');
    expect(getDesignFileIconColor('js')).toBe('#f7df1e');
    expect(getDesignFileIconColor('ts')).toBe('#3178c6');
    expect(getDesignFileIconColor('sql')).toBe('var(--info, var(--state-running))');
    expect(getDesignFileIconColor('git')).toBe('#f05032');
    expect(getDesignFileIconColor('xlsx')).toBe('#217346');
    expect(getDesignFileIconColor('file')).toBe('var(--td-ink-subtle)');
  });

  it('exposes a complete color map for every file icon type', () => {
    const types = Object.keys(DESIGN_FILE_ICON_COLORS);
    expect(types.length).toBeGreaterThanOrEqual(18);
    for (const type of types) {
      expect(getDesignFileIconColor(type as keyof typeof DESIGN_FILE_ICON_COLORS)).toBe(
        DESIGN_FILE_ICON_COLORS[type as keyof typeof DESIGN_FILE_ICON_COLORS],
      );
    }
  });

  it('type-guards known file icon types', () => {
    expect(isDesignFileIconType('ts')).toBe(true);
    expect(isDesignFileIconType('tsx')).toBe(true);
    expect(isDesignFileIconType('unknown-kind')).toBe(false);
  });

  it('keeps icon sizing constants aligned to tokendance-design/desktop CSS', () => {
    expect(DESIGN_FILE_ICON_SIZE).toBe(17);
    expect(DESIGN_FILE_ICON_RADIUS).toBe(3);
    expect(DESIGN_NAV_ICON_SIZE).toBe(16);
    expect(DESIGN_NAV_ICON_STROKE_WIDTH).toBe(1.9);
    expect(DESIGN_NAV_GLYPH_SIZE).toBe(17);
    expect(DESIGN_NAV_GLYPH_STROKE_WIDTH).toBe(1.85);
  });

  it('maps profile action labels through ordered keyword rules', () => {
    expect(profileActionIconName('发送消息')).toBe('notes');
    expect(profileActionIconName('打开项目')).toBe('grid');
    expect(profileActionIconName('云文档入口')).toBe('fileText');
    expect(profileActionIconName('复制链接')).toBe('copy');
    expect(profileActionIconName('退出登录')).toBe('logout');
    expect(profileActionIconName('显示二维码')).toBe('qrcode');
    expect(profileActionIconName('查看名片')).toBe('user');
    expect(profileActionIconName('个人资料')).toBe('user');
    expect(profileActionIconName('帮助中心')).toBe('help');
    expect(profileActionIconName('联系客服')).toBe('help');
    expect(profileActionIconName('邀请同事')).toBe('userPlus');
    expect(profileActionIconName('unknown action')).toBe('external');
  });

  it('keeps profile action rules ordered with first-match wins', () => {
    expect(PROFILE_ACTION_ICON_RULES.length).toBeGreaterThan(10);
    expect(PROFILE_ACTION_ICON_RULES[0]?.[0]).toBe('消息');
  });
});
