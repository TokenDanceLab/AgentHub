export async function resolve(specifier, context, nextResolve) {
  // Intercept known JSON packages and .json specifiers early
  if (
    specifier.endsWith('.json') ||
    specifier === '@emoji-mart/data' ||
    specifier.startsWith('@emoji-mart/data/')
  ) {
    return {
      shortCircuit: true,
      format: 'module',
      url: 'data:text/javascript,export default {}',
    };
  }

  try {
    const result = await nextResolve(specifier, context);
    // Resolution succeeded but returned a .json URL (package with JSON main)
    if (result.url && result.url.endsWith('.json')) {
      return {
        shortCircuit: true,
        format: 'module',
        url: 'data:text/javascript,export default {}',
      };
    }
    return result;
  } catch (e) {
    const parent = context.parentURL || '';
    if (parent.includes('/node_modules/')) {
      // Fix directory imports (./dir -> ./dir/index.js) and extension-less imports
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
