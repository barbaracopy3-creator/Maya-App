require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })

const cron = require('node-cron')
const express = require('express')
const cors = require('cors')
const OpenAI = require('openai')
const { createClient } = require('@supabase/supabase-js')

const app = express()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// Busca todos os eventos
app.get('/eventos', async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('data', { ascending: true })
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

// Deleta evento
app.delete('/eventos/:id', async (req, res) => {
  const { id } = req.params
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Marca como feito
app.patch('/eventos/:id', async (req, res) => {
  const { id } = req.params
  const { feito } = req.body
  const { error } = await supabase.from('events').update({ feito }).eq('id', id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Edita evento
app.put('/eventos/:id', async (req, res) => {
  const { id } = req.params
  const { titulo, data, hora } = req.body
  const { error } = await supabase.from('events').update({ titulo, data, hora }).eq('id', id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Chat principal
app.post('/chat', async (req, res) => {
  const { mensagem, eventos } = req.body

  const { data: metas } = await supabase
    .from('metas').select('*').eq('ativa', true)

  const { data: diarioRecente } = await supabase
    .from('diario').select('*')
    .order('data', { ascending: false }).limit(5)

  try {
    const resposta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é a Maya, assistente pessoal inteligente.

Analise a mensagem e retorne SEMPRE um JSON puro, sem texto extra.

REGRAS:
- Se for um evento único: retorna um objeto
- Se for recorrente (ex: "toda segunda", "segunda e terça", "todo dia"): retorna um ARRAY de objetos
- Extraia: titulo, tipo (evento ou tarefa), data (YYYY-MM-DD), hora (HH:MM ou null), confirmacao
- Datas relativas: hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Para dias da semana como "segunda e terça", calcule as próximas ocorrências
- Para "toda segunda", gere as próximas 4 ocorrências

FORMATO evento único:
{"tipo":"evento","titulo":"nome","data":"YYYY-MM-DD","hora":"HH:MM","confirmacao":"mensagem amigável"}

FORMATO recorrente (array):
[
  {"tipo":"evento","titulo":"nome","data":"YYYY-MM-DD","hora":"HH:MM","confirmacao":"mensagem amigável"},
  {"tipo":"evento","titulo":"nome","data":"YYYY-MM-DD","hora":"HH:MM","confirmacao":""}
]

CONFLITOS: eventos existentes na agenda:
${JSON.stringify(eventos || [])}
Se houver conflito (menos de 30 min de diferença), adicione "conflito": true e "mensagem_conflito": "explicação e sugestão"

Se o usuário quiser apagar, deletar ou remover um evento, retorne:
{"tipo":"delete","titulo":"nome do evento que quer apagar","confirmacao":"mensagem confirmando"}

Se o usuário quiser editar, mudar, alterar ou remarcar um evento, retorne:
{"tipo":"editar","titulo_original":"nome atual do evento","titulo":"novo nome ou mesmo nome","data":"YYYY-MM-DD","hora":"HH:MM","confirmacao":"mensagem confirmando a alteração"}

Se o usuário fizer uma pergunta pessoal sobre metas, progresso, rotina ou pedir conselhos (ex: "estou no caminho certo?", "o que devo fazer essa semana?", "como posso melhorar?"), retorne:
{"tipo":"reflexao","confirmacao":"resposta honesta, empática e prática baseada nas metas e diário da usuária"}

CONTEXTO PESSOAL DA USUÁRIA:
${metas && metas.length > 0 ? `Metas: ${JSON.stringify(metas)}` : 'Sem metas cadastradas ainda.'}
${diarioRecente && diarioRecente.length > 0 ? `Diário recente: ${JSON.stringify(diarioRecente)}` : ''}`
        },
        { role: 'user', content: mensagem }
      ]
    })

    const texto = resposta.choices[0].message.content
    const dados = JSON.parse(texto)
    const lista = Array.isArray(dados) ? dados : [dados]

    if (lista[0].tipo === 'delete' || lista[0].tipo === 'editar' || lista[0].tipo === 'reflexao') {
      return res.json(lista[0])
    }

    const conflito = lista.find(ev => ev.conflito)
    if (conflito) {
      return res.json({ conflito: true, mensagem_conflito: conflito.mensagem_conflito })
    }

    const { error } = await supabase.from('events').insert(
      lista.map(ev => ({
        titulo: ev.titulo,
        tipo: ev.tipo,
        data: ev.data,
        hora: ev.hora || null
      }))
    )

    if (error) throw error

    res.json({ lista, confirmacao: lista[0].confirmacao, tipo: lista[0].tipo })

  } catch (erro) {
    console.error('Erro:', erro)
    res.status(500).json({ erro: 'Algo deu errado' })
  }
})

// Busca relatórios
app.get('/relatorios', async (req, res) => {
  const { data, error } = await supabase
    .from('relatorios').select('*')
    .order('criado_em', { ascending: false }).limit(4)
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

// Gera relatório semanal completo
async function gerarRelatorio() {
  const hoje = new Date()
  const semanaPassada = new Date(hoje)
  semanaPassada.setDate(hoje.getDate() - 7)

  const { data: eventos } = await supabase
    .from('events').select('*')
    .gte('data', semanaPassada.toISOString().split('T')[0])
    .lte('data', hoje.toISOString().split('T')[0])

  const { data: metas } = await supabase
    .from('metas').select('*').eq('ativa', true)

  const { data: diario } = await supabase
    .from('diario').select('*')
    .gte('data', semanaPassada.toISOString().split('T')[0])
    .order('data', { ascending: false })

  if (!eventos || eventos.length === 0) return

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é a Maya, assistente pessoal inteligente e direta.
Analise a semana completa e gere um relatório integrado em português com:

1. RESUMO DA SEMANA — o que foi feito em 2-3 frases
2. DISTRIBUIÇÃO DE TEMPO — quais categorias mais apareceram
3. ALINHAMENTO COM METAS — nota de 1 a 10 e análise honesta
4. PADRÃO DA SEMANA — algo que você notou
5. AÇÃO PRIORITÁRIA — uma coisa concreta para a próxima semana

Seja direta, empática e use no máximo 300 palavras.
${metas && metas.length > 0 ? 'Considere as metas na análise.' : ''}`
      },
      {
        role: 'user',
        content: `Eventos: ${JSON.stringify(eventos)}
${metas && metas.length > 0 ? `Metas: ${JSON.stringify(metas)}` : ''}
${diario && diario.length > 0 ? `Diário: ${JSON.stringify(diario)}` : ''}`
      }
    ]
  })

  const conteudo = resposta.choices[0].message.content

  await supabase.from('relatorios').insert({
    semana_inicio: semanaPassada.toISOString().split('T')[0],
    semana_fim: hoje.toISOString().split('T')[0],
    conteudo
  })

  console.log('Relatório gerado')
  return conteudo
}

// Rota manual para relatório
app.get('/gerar-relatorio', async (req, res) => {
  const conteudo = await gerarRelatorio()
  res.json({ conteudo })
})

// Agenda relatório todo domingo às 20h
cron.schedule('0 20 * * 0', () => {
  gerarRelatorio()
}, { timezone: 'America/Sao_Paulo' })

// Diário
app.get('/diario', async (req, res) => {
  const { data, error } = await supabase
    .from('diario').select('*')
    .order('data', { ascending: false }).limit(30)
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

app.post('/diario', async (req, res) => {
  const { conteudo, humor, data } = req.body
  const { error } = await supabase.from('diario').insert({ conteudo, humor, data })
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Metas
app.get('/metas', async (req, res) => {
  const { data, error } = await supabase
    .from('metas').select('*').eq('ativa', true)
    .order('criado_em', { ascending: true })
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

app.post('/metas', async (req, res) => {
  const { titulo, descricao, categoria, prazo } = req.body
  const { error } = await supabase.from('metas').insert({ titulo, descricao, categoria, prazo })
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Análise de alinhamento
app.get('/analise', async (req, res) => {
  const { data: metas } = await supabase.from('metas').select('*').eq('ativa', true)
  const { data: eventos } = await supabase.from('events').select('*')
    .gte('data', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
  const { data: diario } = await supabase.from('diario').select('*')
    .order('data', { ascending: false }).limit(7)

  if (!metas || metas.length === 0) {
    return res.json({ conteudo: 'Cadastre suas metas primeiro para eu poder analisar seu alinhamento.' })
  }

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é a Maya, assistente pessoal inteligente e direta.
Analise se a rotina está alinhada com as metas.
Seja honesta, empática e prática. Máximo 250 palavras.
Estruture assim:
🎯 ALINHAMENTO — nota de 1 a 10 e por quê
✅ O QUE ESTÁ FUNCIONANDO
⚠️ PONTO DE ATENÇÃO
💡 AÇÃO DA SEMANA`
      },
      {
        role: 'user',
        content: `Metas: ${JSON.stringify(metas)}
Rotina essa semana: ${JSON.stringify(eventos)}
Diário recente: ${JSON.stringify(diario)}`
      }
    ]
  })

  res.json({ conteudo: resposta.choices[0].message.content })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Maya rodando em http://localhost:${PORT}`)
})