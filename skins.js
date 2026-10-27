// Formato de skin (usado pelo jogo e pelo painel). Só estas chaves são aceitas; cores precisam ser #hex.
export const ACCS = ['cap', 'beanie', 'phones', 'spikes', 'visor', 'crown'];
export const FLAGS = ['br', 'fr', 'uk'];
export const COLOR_KEYS = ['hood', 'sleeve', 'pants', 'cap', 'skin', 'shoe', 'chain', 'detail', 'hand', 'hairCol', 'belt', 'backCol', 'bag'];
export const BOOL_KEYS = ['baggy', 'nohair', 'shorts'];
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
export function cleanSkin(raw) {
  let o = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o.replace(/^```(?:json)?|```$/gm, '').trim()); } catch (_) { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = { n: String(o.n || o.name || 'Skin').replace(/[<>"&]/g, '').slice(0, 18) || 'Skin' };
  for (const k of COLOR_KEYS) if (HEX.test(o[k] || '')) r[k] = o[k];
  for (const k of BOOL_KEYS) if (o[k]) r[k] = true;
  r.acc = ACCS.includes(o.acc) ? o.acc : 'cap';
  if (FLAGS.includes(o.flag)) r.flag = o.flag;
  if (o.capDir === 'back' || o.capDir === 'front') r.capDir = o.capDir;
  for (const k of ['holdL', 'holdR']) if (typeof o[k] === 'string' && o[k].trim()) r[k] = o[k].trim().slice(0, 40);
  if (typeof o.objectDesc === 'string' && o.objectDesc.trim()) r.objectDesc = o.objectDesc.trim().slice(0, 120);
  if (typeof o.styleDesc === 'string' && o.styleDesc.trim()) r.styleDesc = o.styleDesc.trim().slice(0, 120);
  if (Number(o.agile) > 1) r.agile = Math.min(1.5, Math.round(Number(o.agile) * 100) / 100);
  const pr = Math.max(0, Math.min(100000, Math.round(Number(o.price) || 0))); if (pr) r.price = pr;
  if (typeof o.backText === 'string' && o.backText.trim()) r.backText = o.backText.replace(/[<>"&]/g, '').slice(0, 10).toUpperCase();
  const need = ['hood', 'pants', 'cap', 'skin'];
  for (const k of need) if (!r[k]) return null;
  return r;
}
// Prompt base: cole na IA (ChatGPT, Claude...) e troque a última linha pela ideia da skin.
export const BASE_PROMPT = `Você vai criar UMA skin de personagem para o jogo Subway Run (corredor 3D de blocos).
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem explicações.

Campos permitidos (todas as cores em hexadecimal, ex.: "#ff5c8a"):
- "n": nome da skin (até 18 caracteres)
- "hood": cor da blusa/jaqueta   - "sleeve": cor das mangas (opcional)
- "pants": cor da calça/bermuda   - "shoe": cor do tênis (opcional)
- "cap": cor do chapéu/boné/acessório de cabeça   - "skin": cor da pele
- "acc": acessório da cabeça, UM destes: cap, beanie, phones, spikes, visor, crown
- "capDir": "front" ou "back" (boné para frente ou para trás; só para cap/beanie)
- "chain": cor da corrente (opcional)   - "detail": cor de detalhes (opcional)
- "belt": cor do cinto (opcional)       - "hairCol": cor do cabelo (opcional)
- "baggy": true para roupa larga (opcional)   - "shorts": true para bermuda (opcional)
- "nohair": true se não tiver cabelo (opcional)
- "bag": cor de uma bolsa transversal (opcional)
- "holdL" / "holdR": objeto pedido para a mão esquerda/direita (texto livre, até 40 caracteres; ex.: "troféu dourado", "bola de futebol", "espada de brinquedo") (opcional)\n- "objectDesc": descrição curta de objeto/acessório especial solicitado (até 120 caracteres; opcional)\n- "styleDesc": estilo visual personalizado (até 120 caracteres; opcional)
- "price": preço em moedas (número)
- "flag": "br", "fr" ou "uk" (bandeirinha na roupa; opcional)
- "backText": palavra curta nas costas, até 10 letras (opcional)

Exemplo:
{"n":"Skatista","hood":"#2f7bff","sleeve":"#f7f7fb","pants":"#1f2937","cap":"#ffd21f","skin":"#e8a979","acc":"cap","capDir":"back","baggy":true,"shoe":"#ffffff","chain":"#ffd21f","detail":"#ffd21f"}

Interprete literalmente o pedido do usuário e personalize o máximo possível: roupas, cortes de cabelo, acessórios, símbolos e objetos específicos. Para um objeto na mão, descreva-o em holdL/holdR com o nome e detalhes visuais. Para outros acessórios/estilos não cobertos pelos campos, registre a descrição em objectDesc/styleDesc. Não substitua o objeto solicitado por outro parecido.
Use cores combinando entre si, visual bonito e chamativo. A skin que eu quero é:
`;
