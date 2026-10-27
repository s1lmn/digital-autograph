// Runs before the page paints. Only the allowlisted preference is read.
export const themeInitScript = `(()=>{let t='system';try{const s=localStorage.getItem('autograph-theme');if(s==='light'||s==='dark')t=s}catch{}document.documentElement.dataset.theme=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'})()`;
