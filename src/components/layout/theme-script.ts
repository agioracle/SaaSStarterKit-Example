/** Local-only, defensive prepaint theme setup. No provider, network, or user content is evaluated. */
export function themeInitialization(defaultTheme: string) {
  const fallback = ['light', 'dark', 'system'].includes(defaultTheme) ? defaultTheme : 'system';
  return `(()=>{let theme=${JSON.stringify(fallback)};try{const saved=localStorage.getItem('edgekit-theme');if(['light','dark','system'].includes(saved))theme=saved}catch{}let dark=theme==='dark';if(theme==='system'){try{dark=matchMedia('(prefers-color-scheme: dark)').matches}catch{}}document.documentElement.dataset.theme=dark?'dark':'light'})()`;
}
