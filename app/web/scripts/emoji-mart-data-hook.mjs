export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@emoji-mart/data' || specifier.startsWith('@emoji-mart/data/')) {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export default {}',
    };
  }
  return nextResolve(specifier, context);
}
