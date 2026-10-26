import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.79: o construtor da Tonelagem no painel do gestor (Maquete 1 de
// docs/design/tonelagem/tonelagem-aprovado.html): o sexto cartão, as quatro
// seções, a lista de exercícios com o marcador "Conta", a carga, o incremento, o
// time cap obrigatório e a regra. Renderização de servidor; o comportamento
// interativo foi conferido no navegador (ver a story).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const { SheetBuilderPanel } = await importServerModule('components/admin/WorkoutSheetBuilderDialog.tsx');
const { WorkoutStructureEditor } = await importServerModule('components/admin/WorkoutStructureEditor.tsx');
const editor = await importServerModule('lib/workoutStructureEditor.ts');
const { validateWorkoutStructure } = await importServerModule('lib/workoutStructure.ts');

const { addLine, analyzeDraft, createDraft, setDraftFormat, setTonnageLift, updateLine, updateTonnage } = editor;
const formSource = read('../src/components/admin/SheetBuilderForm.tsx');

const renderPanel = (draft, props = {}) => renderToStaticMarkup(createElement(SheetBuilderPanel, {
  initialDraft: draft, idPrefix: 'b', workoutName: 'Squat Clean', onCancel: () => {}, onSave: () => {}, ...props
}));
const sectionOf = (html, title) => html.slice(html.indexOf(`</span>${title}</h3>`), html.indexOf('</section>', html.indexOf(`</span>${title}</h3>`)));

const treino1 = (patch = {}) => {
  let draft = setDraftFormat(createDraft('for_time'), 'tonnage');
  draft = updateLine(draft, 'tonnage', draft.tonnage.lines[0].key, { reps: '10', name: 'Pull Ups' });
  draft = addLine(draft, 'tonnage');
  draft = updateLine(draft, 'tonnage', draft.tonnage.lines[1].key, { reps: '10', name: 'Burpees' });
  draft = addLine(draft, 'tonnage');
  const lift = draft.tonnage.lines[2];
  draft = updateLine(draft, 'tonnage', lift.key, { name: 'Squat Clean' });
  draft = setTonnageLift(draft, lift.key);
  return updateTonnage(draft, { duration: '10:00', ...patch });
};

test('sexto cartão: Tonelagem, com o texto da maquete, escolhido; os seis cartões em 3 + 3 e um ponto de Tab', () => {
  const html = renderPanel(treino1());
  const cards = [...html.matchAll(/id="b-format-([a-z_]+)"[^>]*role="radio"[^>]*aria-checked="(true|false)"[^>]*tabindex="(-?\d)"/g)].map((match) => match.slice(1));
  assert.deepEqual(cards, [['for_time', 'false', '-1'], ['amrap', 'false', '-1'], ['max_load', 'false', '-1'], ['interval', 'false', '-1'], ['distance', 'false', '-1'], ['tonnage', 'true', '0']]);
  assert.match(html, /id="b-format-tonnage"[^>]*>.*?<svg[^>]*lucide-check[\s\S]*?<\/svg>Tonelagem<\/span><span[^>]*>Soma de carga × repetições do exercício marcado<\/span><\/button>/s);
  assert.equal((html.match(/role="radio"/g) || []).filter(Boolean).length >= 6, true);
  assert.equal((html.match(/lucide-check/g) || []).length, 1, 'só o cartão escolhido leva o Check');
  const spans = [...html.matchAll(/id="b-format-[a-z_]+"[^>]*class="[^"]*?(sm:col-span-\d)[^"]*"/g)].map((match) => match[1]);
  assert.deepEqual(spans, Array(6).fill('sm:col-span-2'));
});

test('seções 1 a 5 e os títulos da maquete', () => {
  const html = renderPanel(treino1());
  const titles = [...html.matchAll(/<h3 id="b-[a-z-]+"[^>]*><span class="font-number text-primary">(\d)<\/span>([^<]+)<\/h3>/g)].map((match) => `${match[1]} ${match[2]}`);
  assert.deepEqual(titles, ['1 Formato da prova', '2 Exercícios, na ordem', '3 Carga e incremento do exercício que conta', '4 Time cap da prova', '5 Regra da prova']);
});

test('lista de exercícios: reps, movimento e carga; o que conta tem a quantidade e a carga desligadas e o marcador "Conta"', () => {
  const html = renderPanel(treino1());
  const lines = sectionOf(html, 'Exercícios, na ordem');
  assert.match(lines, />Repetições<\/span>.*?>Movimento<\/span>.*?>Carga \(kg\)<\/span>/s);
  assert.match(lines, /<input id="b-tn-k6-reps"[^>]*aria-label="Repetições do exercício 1"[^>]*value="10"/s);
  assert.match(lines, /<input id="b-tn-k6-name"[^>]*aria-label="Movimento 1"[^>]*value="Pull Ups"/s);
  // O terceiro é o que conta: reps e carga desligadas, com os textos "livre" e "passo 3".
  const liftKey = treino1().tonnage.liftKey;
  assert.match(lines, new RegExp(`<input id="b-tn-${liftKey}-reps"[^>]*disabled=""[^>]*placeholder="livre"`));
  assert.match(lines, new RegExp(`<input id="b-tn-${liftKey}-load"[^>]*disabled=""[^>]*placeholder="passo 3"`));
  assert.equal((lines.match(/type="radio"/g) || []).length, 3, 'um marcador "Conta" por linha');
  assert.equal((lines.match(/checked=""/g) || []).length, 1, 'um só marcado');
  assert.match(lines, new RegExp(`<input id="b-tn-${liftKey}-count" type="radio"[^>]*name="b-tn-lift"[^>]*checked=""`));
  assert.match(lines, /Libera o atleta · não conta ponto/);
  assert.match(lines, /Conta para a tonelagem · repetições livres, carga definida no passo 3/);
  assert.doesNotMatch(lines, /Depois da tonelagem · não conta nem trava/);
  // Remover: o que conta não se remove (botão desligado, com o motivo no rótulo); os outros sim.
  assert.match(lines, /<button type="button" disabled=""[^>]*aria-label="O exercício 3 conta para a tonelagem: marque outro para poder removê-lo"/);
  assert.match(lines, /<button type="button" aria-label="Remover o exercício 1" class="[^"]*"><svg/);
  assert.match(lines, /Adicionar exercício<\/button>/);
  assert.match(lines, /Marque &quot;Conta&quot; em um deles\. Os de antes liberam o atleta e não contam ponto/);
});

test('o que conta em qualquer posição: os de depois aparecem como "não conta nem trava"', () => {
  let draft = treino1();
  draft = updateLine(draft, 'tonnage', draft.tonnage.lines[2].key, { reps: '5' });
  draft = setTonnageLift(draft, draft.tonnage.lines[0].key);
  const lines = sectionOf(renderPanel(draft), 'Exercícios, na ordem');
  assert.equal((lines.match(/Depois da tonelagem · não conta nem trava/g) || []).length, 2);
  assert.doesNotMatch(lines, /Libera o atleta/);
});

test('carga e incremento: livre e travado por padrão; prescrita e passo só aparecem escolhidos', () => {
  const free = sectionOf(renderPanel(treino1()), 'Carga e incremento do exercício que conta');
  assert.match(free, /De onde vem a carga/);
  assert.match(free, /<input type="radio"[^>]*name="b-tn-mode"[^>]*checked=""[^>]*\/>Livre \(o atleta escolhe\)/);
  assert.match(free, /Prescrita pelo gestor/);
  assert.match(free, /Incrementar a carga durante o treino/);
  assert.match(free, /<input type="radio"[^>]*name="b-tn-inc"[^>]*checked=""[^>]*\/>Não permitir/);
  assert.match(free, /Permitir subir/);
  assert.doesNotMatch(free, /id="b-tn-prescribed"/);
  assert.doesNotMatch(free, /id="b-tn-step"/);

  const prescribed = sectionOf(renderPanel(treino1({ loadMode: 'prescribed', prescribed: '60', incrementAllowed: true, step: '5' })), 'Carga e incremento do exercício que conta');
  assert.match(prescribed, /<label for="b-tn-prescribed"[^>]*>Carga prescrita \(kg\)<\/label>/);
  assert.match(prescribed, /<input id="b-tn-prescribed" type="text" inputMode="decimal" autoComplete="off" aria-invalid="false"[^>]*value="60"\/>/);
  assert.match(prescribed, /<label for="b-tn-step"[^>]*>Passo de cada incremento \(kg\)<\/label>/);
  assert.match(prescribed, /<input id="b-tn-step" type="text" inputMode="decimal" autoComplete="off" aria-invalid="false"[^>]*value="5"\/>/);

  // Erros dos campos, com a mensagem do construtor.
  const bad = sectionOf(renderPanel(treino1({ loadMode: 'prescribed', prescribed: '', incrementAllowed: true, step: '2,6' })), 'Carga e incremento do exercício que conta');
  assert.match(bad, /aria-invalid="true"[^>]*value=""/);
  assert.match(bad, /Carga prescrita: de 0,25 a 500 kg, em múltiplos de 0,25 \(ex\.: 60 ou 42,5\)\./);
  assert.match(bad, /Incremento: de 0,25 a 25 kg, em múltiplos de 0,25\./);
});

test('time cap: obrigatório, sem valor padrão, e o erro aparece no campo', () => {
  const draft = createDraft('tonnage');
  assert.equal(draft.tonnage.duration, '');
  const html = renderPanel(draft);
  const cap = sectionOf(html, 'Time cap da prova');
  assert.match(cap, /<label for="b-tn-duration"[^>]*>Duração \(MM:SS\)<\/label>/);
  assert.match(cap, /<input id="b-tn-duration" type="text" inputMode="numeric" autoComplete="off" placeholder="ex\.: 03:00" required="" aria-invalid="true"[^>]*value=""\/>/);
  assert.match(cap, /Time cap: informe o tempo da prova, de 00:30 a 99:59 \(obrigatório\)\./);
  const filled = sectionOf(renderPanel(treino1()), 'Time cap da prova');
  assert.match(filled, /aria-invalid="false"[^>]*value="10:00"/);
  assert.match(filled, /Obrigatório, de 00:30 a 99:59\. Em branco, a prova não pode ser salva\./);
});

test('regra da prova: a conferência com ✓ e !, a frase da regra e o botão "Usar esta súmula" só com a estrutura válida', () => {
  const ok = renderPanel(treino1({ incrementAllowed: true, step: '2,5' }));
  const rule = sectionOf(ok, 'Regra da prova');
  assert.match(rule, /Exercício que conta: Squat Clean/);
  assert.match(rule, /2 exercícios liberam o atleta \(não contam ponto\)/);
  assert.match(rule, /Carga livre: o judge informa antes de iniciar/);
  assert.match(rule, /Incremento permitido, de 2,5 em 2,5 kg/);
  assert.match(rule, /Time cap: 10:00/);
  assert.match(rule, /<span>Para liberar o atleta: <\/span><strong[^>]*>10 Pull Ups<\/strong><span> e <\/span><strong[^>]*>10 Burpees<\/strong><span> \(não contam ponto\)\. <\/span>/);
  assert.match(rule, /<span>A tonelagem é a <\/span><strong[^>]*>soma de carga × repetições válidas<\/strong>/);
  assert.match(rule, /Mesma tonelagem divide a posição\./);
  assert.match(ok, /Súmula pronta\. Ela é gravada quando você salvar a prova\./);
  assert.match(ok, /id="b-use"[^>]*class="[^"]*"[^>]*>Usar esta súmula<\/button>/);
  assert.doesNotMatch(ok, /id="b-use" type="button" disabled=""/);

  const broken = renderPanel(createDraft('tonnage'));
  const brokenRule = sectionOf(broken, 'Regra da prova');
  assert.match(brokenRule, /A regra aparece aqui quando os itens marcados com ! forem corrigidos\./);
  assert.match(brokenRule, />!<\/span><span class="text-white"><span class="sr-only">Corrigir: <\/span>Linha 1: informe o movimento\./);
  assert.match(broken, /id="b-use" type="button" disabled=""/);
  assert.match(broken, /itens? para corrigir/);
});

test('a súmula do judge ao lado: o painel mostra a prévia da tonelagem com a carga do atleta', () => {
  const html = renderPanel(treino1());
  assert.match(html, /Como o judge verá/);
  assert.match(html, /aria-label="Súmula digital da tonelagem"/);
  assert.match(html, /Carga do atleta · Squat Clean \(kg\)/);
  const broken = renderPanel(createDraft('tonnage'));
  assert.match(broken, /Corrija os itens marcados com ! para ver a súmula\./);
});

test('painel do formulário: o resumo da prova gravada reabre no construtor da tonelagem (ida e volta)', () => {
  const structure = analyzeDraft(treino1({ loadMode: 'prescribed', prescribed: '60', incrementAllowed: true, step: '10' })).structure;
  assert.equal(validateWorkoutStructure(structure).ok, true);
  const html = renderToStaticMarkup(createElement(WorkoutStructureEditor, { value: structure, onChange: () => {}, idPrefix: 't', workoutName: 'Squat Clean' }));
  assert.match(html, /Tonelagem · Squat Clean · 3 exercícios · cap 10:00/);
  assert.match(html, /Para liberar o atleta:/);
  const back = editor.draftFromStructure(structure);
  assert.equal(back.ok, true);
  assert.deepEqual(
    [back.draft.format, back.draft.tonnage.loadMode, back.draft.tonnage.prescribed, back.draft.tonnage.incrementAllowed, back.draft.tonnage.step, back.draft.tonnage.duration],
    ['tonnage', 'prescribed', '60', true, '10', '10:00']
  );
  assert.deepEqual(analyzeDraft(back.draft).structure, structure);
});

test('o componente não grava: sem rede, sem useApp, sem banco e sem armazenamento local', () => {
  assert.doesNotMatch(formSource, /fetch\(|useApp|supabase|localStorage|sessionStorage|indexedDB/);
  assert.match(formSource, /import \{[^}]*MAX_TONNAGE_LINES[^}]*\} from '@\/lib\/workoutStructureEditor';/s);
});
