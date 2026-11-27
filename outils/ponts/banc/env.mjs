// Node : les modules de src/ qui lisent import.meta.env (Vite) reçoivent des valeurs fixes
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, nextLoad) {
    const r = nextLoad(url, context);
    if (!url.includes("/src/") || !r.source) return r;
    const s = r.source.toString();
    if (!s.includes("import.meta.env")) return r;
    return { ...r, source: s.replaceAll("import.meta.env.BASE_URL", '"/"').replaceAll("import.meta.env.DEV", "false").replaceAll("import.meta.env", "({})") };
  },
});
