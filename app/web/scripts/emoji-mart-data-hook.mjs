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
      return {
        shortCircuit: true,
        format: 'module',
        url: 'data:text/javascript,export default {}',
      };
    }
    throw e;
  }
}
