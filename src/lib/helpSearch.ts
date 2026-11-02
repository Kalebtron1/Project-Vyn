export interface HelpItem {
  q: string;
  a: string;
  link?: string;
  link_label?: string;
}

export interface HelpCategory {
  id: string;
  title: string;
  items: HelpItem[];
}

/** Sin mayúsculas ni acentos: "crédito" y "credito" deben encontrar lo mismo. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Deja las preguntas que contienen todas las palabras buscadas, y quita categorías vacías. */
export function searchHelp(categories: HelpCategory[], query: string): HelpCategory[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return categories;

  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const text = normalize(`${category.title} ${item.q} ${item.a}`);
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((category) => category.items.length > 0);
}
