/** A small way to build elements. Text is always set as text, never as
 * markup, so nothing read from the chain can change what the popup is. */
type Child = Node | string | null | undefined | false;
type Props = Record<string, string | boolean | ((e: Event) => void) | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.replace(/^on/, ""), value);
    else el.setAttribute(name === "className" ? "class" : name, value === true ? "" : value);
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}
const SVG = "http://www.w3.org/2000/svg";
export function svg(tag: string, attrs: Record<string, string>, ...children: Node[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}
