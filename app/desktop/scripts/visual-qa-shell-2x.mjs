/** Thin wrapper: force VISUAL_QA_DPR=2 then run shell capture (#1308). */
process.env.VISUAL_QA_DPR = process.env.VISUAL_QA_DPR || '2';
await import('./visual-qa-shell.mjs');
