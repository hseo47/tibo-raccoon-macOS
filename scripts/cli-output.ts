const UNSAFE_CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;
const UNSAFE_CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/gu;

export function hasUnsafeControl(value: string): boolean {
  return UNSAFE_CONTROL.test(value);
}

export function printableOneLine(value: string): string {
  return value.replace(UNSAFE_CONTROLS, (character) => {
    if (character === '\n') return '\\n';
    if (character === '\r') return '\\r';
    if (character === '\t') return '\\t';
    return `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`;
  });
}
