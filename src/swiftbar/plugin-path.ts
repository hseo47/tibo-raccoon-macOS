const UNSAFE_PLUGIN_PATH = /[\r\n|\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export function isRepresentableSwiftBarPluginPath(value: string): boolean {
  try {
    quoteSwiftBarPluginPath(value);
    return true;
  } catch {
    return false;
  }
}

export function quoteSwiftBarPluginPath(value: string): string {
  if (!value.startsWith('/') || value.endsWith('\\') || UNSAFE_PLUGIN_PATH.test(value)) {
    throw new Error('Plugin path must be a safe absolute path');
  }
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new Error('Plugin path cannot contain both quote delimiters');
}
