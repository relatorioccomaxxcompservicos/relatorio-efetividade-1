// API do dashboard (Cloudflare Worker + D1). Filtros: ?empresa=&cargo=&de=YYYY-MM-DD&ate=YYYY-MM-DD
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } });
const PCT = (n, d) => `ROUND(100.0*SUM(${n})/NULLIF(SUM(${d}),0),2)`;
const AGG = `SUM(qe_d) qe_d, SUM(efet_d) efet_d, ${PCT('efet_d','qe_d')} pct_d, SUM(qe_n) qe_n, SUM(efet_n) efet_n, ${PCT('efet_n','qe_n')} pct_n, SUM(faltas_d+faltas_n) faltas, SUM(res_d+res_n) reservas`;

function where(u) {
  const w = [], p = [], f = { empresa: 'empresa = ?', cargo: 'cargo = ?', de: 'data >= ?', ate: 'data <= ?' };
  for (const k in f) if (u.searchParams.get(k)) { w.push(f[k]); p.push(u.searchParams.get(k)); }
  return [w.length ? 'WHERE ' + w.join(' AND ') : '', p];
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url), [W, P] = where(u), run = async (sql) => (await env.DB.prepare(sql).bind(...P).all()).results;
    try {
      switch (u.pathname) {
        case '/api/filters': return json({
          empresas: (await env.DB.prepare('SELECT DISTINCT empresa FROM efetividade ORDER BY 1').all()).results.map(r => r.empresa),
          cargos: (await env.DB.prepare('SELECT DISTINCT cargo FROM efetividade ORDER BY 1').all()).results.map(r => r.cargo),
          ...(await env.DB.prepare('SELECT MIN(data) de, MAX(data) ate FROM efetividade').first()) });
        case '/api/summary': return json((await run(`SELECT ${AGG}, COUNT(DISTINCT posto) postos, COUNT(DISTINCT data) dias FROM efetividade ${W}`))[0]);
        case '/api/daily': return json(await run(`SELECT data, MAX(dia_semana) dia_semana, ${AGG} FROM efetividade ${W} GROUP BY data ORDER BY data`));
        case '/api/ranking': { // ?by=empresa|posto|cargo (padrão: posto) — menor efetividade primeiro
          const by = ['empresa', 'posto', 'cargo'].includes(u.searchParams.get('by')) ? u.searchParams.get('by') : 'posto';
          return json(await run(`SELECT ${by} nome, ${AGG} FROM efetividade ${W} GROUP BY ${by} HAVING SUM(qe_d)>0 ORDER BY pct_d ASC, faltas DESC LIMIT 50`)); }
        case '/api/faltas': return json(await run(`SELECT data, empresa, posto, cargo, faltas_d, faltas_n, res_d, res_n, colaborador_falta, reserva_cobertura FROM efetividade ${W ? W + ' AND' : 'WHERE'} (faltas_d+faltas_n)>0 ORDER BY data DESC, empresa, posto`));
        default: return json({ erro: 'rota não encontrada' }, 404);
      }
    } catch (e) { return json({ erro: String(e) }, 500); }
  }
};
