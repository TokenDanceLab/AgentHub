/**
 * 前端 coverage 合同 factory（#1535）
 *
 * 假绿历史：coverage.include 缺省时，v8 只统计"被测试 import 过的文件"，
 * 未被测试加载的生产模块从分母消失 —— 删模块、忘测试，覆盖率数字照样好看。
 * 本 factory 强制 include 全部 production src（src 下全部 .ts/.tsx 文件），
 * 任何未导入模块都会以 0% 出现在 coverage 报告里，由
 * scripts/verify/verify-coverage-baseline.py 的 uncovered ratchet 拦截。
 *
 * 每个 package 只传真实差异（阈值 + 额外窄排除）；排除必须逐项具体理由，
 * 禁止整类通配排除生产代码（Issue #1535 禁止清单）。
 */
export interface CoverageOptions {
  /** 绝对 floors：已高于 60 的维度至少 60；低于 60 的以实测值减容差为起点 */
  thresholds: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  /** 额外窄排除（带理由注释，见各 package config） */
  exclude?: string[];
}

export function createCoverage(options: CoverageOptions) {
  const { thresholds, exclude = [] } = options;
  return {
    provider: 'v8' as const,
    // 生产源码全量进分母 —— 这是本合同的根基，不可删。
    include: ['src/**/*.ts', 'src/**/*.tsx'],
    // 默认排除只覆盖"非生产代码"类别：测试自身、Storybook 渲染夹具
    // （*.stories.ts/x，vitest 从不执行、且非生产模块）、测试目录（含 Playwright
    // e2e spec）。夹具/生成物/纯声明文件由各 package 按需窄排除（有理由才排）。
    exclude: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.stories.ts',
      'src/**/*.stories.tsx',
      'src/**/__tests__/**',
      'src/__e2e__/**',
      ...exclude,
    ],
    thresholds,
  };
}
