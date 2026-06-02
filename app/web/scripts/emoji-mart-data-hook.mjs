export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@emoji-mart/data' || specifier.startsWith('@emoji-mart/data/')) {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export default {}',
    };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    const parent = context.parentURL || '';
    if (parent.includes('/node_modules/')) {
      // Try directory import (./dir -> ./dir/index.js)
      if (!specifier.endsWith('.js') && !specifier.endsWith('.mjs') && !specifier.endsWith('.json')) {
        try { return await nextResolve(specifier + '/index.js', context); } catch (_) {}
        try { return await nextResolve(specifier + '.js', context); } catch (_) {}
      }
      return {
        shortCircuit: true,
        format: 'module',
        url: 'data:text/javascript,export default {}',
      };
    }
    throw e;
  }
}
