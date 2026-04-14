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

// Busca todos os eventos do banco
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
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Marca como feito/não feito
app.patch('/eventos/:id', async (req, res) => {
  const { id } = req.params
  const { feito } = req.body
  const { error } = await supabase
    .from('events')
    .update({ feito })
    .eq('id', id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Edita evento
app.put('/eventos/:id', async (req, res) => {
  const { id } = req.params
  const { titulo, data, hora } = req.body
  const { error } = await supabase
    .from('events')
    .update({ titulo, data, hora })
    .eq('id', id)
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Recebe mensagem, chama IA, salva no banco
app.post('/chat', async (req, res) => {
  const { mensagem, eventos } = req.body

  try {
    const resposta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é a Maya, assistente de agenda inteligente.

Analise a mensagem e retorne SEMPRE um JSON puro, sem texto extra.

REGRAS:
- Se for um evento único: retorna um objeto
- Se for recorrente (ex: "toda segunda", "segunda e terça", "todo dia"): retorna um ARRAY de objetos, um para cada dia
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
Só o primeiro objeto do array precisa ter a confirmacao preenchida, os outros deixa vazio.

CONFLITOS: eventos existentes na agenda:
${JSON.stringify(eventos || [])}
Se houver conflito (menos de 30 min de diferença), adicione "conflito": true e "mensagem_conflito": "explicação e sugestão"

Se o usuário quiser apagar, deletar ou remover um evento, retorne:
{"tipo":"delete","titulo":"nome do evento que quer apagar","confirmacao":"mensagem confirmando"}

Se o usuário quiser editar, mudar, alterar ou remarcar um evento, retorne:
{"tipo":"editar","titulo_original":"nome atual do evento","titulo":"novo nome ou mesmo nome","data":"YYYY-MM-DD","hora":"HH:MM","confirmacao":"mensagem confirmando a alteração"}`
        },
        { role: 'user', content: mensagem }
      ]
    })

    const texto = resposta.choices[0].message.content
    const dados = JSON.parse(texto)
    const lista = Array.isArray(dados) ? dados : [dados]

    // Trata delete e editar antes de salvar
    if (lista[0].tipo === 'delete' || lista[0].tipo === 'editar') {
      return res.json(lista[0])
    }

    const conflito = lista.find(ev => ev.conflito)
    if (conflito) {
      return res.json({
        conflito: true,
        mensagem_conflito: conflito.mensagem_conflito
      })
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

    res.json({
      lista,
      confirmacao: lista[0].confirmacao,
      tipo: lista[0].tipo
    })

  } catch (erro) {
    console.error('Erro:', erro)
    res.status(500).json({ erro: 'Algo deu errado' })
  }
})

// Busca relatórios salvos
app.get('/relatorios', async (req, res) => {
  const { data, error } = await supabase
    .from('relatorios')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(4)
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

// Gera relatório semanal
async function gerarRelatorio() {
  const hoje = new Date()
  const semanaPassada = new Date(hoje)
  semanaPassada.setDate(hoje.getDate() - 7)

  const { data: eventos } = await supabase
    .from('events')
    .select('*')
    .gte('data', semanaPassada.toISOString().split('T')[0])
    .lte('data', hoje.toISOString().split('T')[0])

  if (!eventos || eventos.length === 0) return

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é a Maya, assistente pessoal inteligente.
Analise os eventos da semana e gere um relatório em português com:

1. RESUMO DA SEMANA — o que foi feito em 2-3 frases
2. DISTRIBUIÇÃO DE TEMPO — quais categorias de atividade mais apareceram
3. PADRÕES — algo que você notou (ex: muitas reuniões pela manhã, tarefas acumulando)
4. SUGESTÃO — uma dica prática para a próxima semana

Seja direta, amigável e use no máximo 200 palavras. Fale como se estivesse conversando.`
      },
      {
        role: 'user',
        content: `Eventos da semana: ${JSON.stringify(eventos)}`
      }
    ]
  })

  const conteudo = resposta.choices[0].message.content

  await supabase.from('relatorios').insert({
    semana_inicio: semanaPassada.toISOString().split('T')[0],
    semana_fim: hoje.toISOString().split('T')[0],
    conteudo
  })

  console.log('Relatório semanal gerado')
  return conteudo
}

// Rota para gerar relatório manualmente
app.get('/gerar-relatorio', async (req, res) => {
  const conteudo = await gerarRelatorio()
  res.json({ conteudo })
})

// Agenda relatório todo domingo às 20h
cron.schedule('0 20 * * 0', () => {
  console.log('Gerando relatório semanal...')
  gerarRelatorio()
}, {
  timezone: 'America/Sao_Paulo'
})

const PORT = process.env.PORT || 3000
// Busca entradas do diário
app.get('/diario', async (req, res) => {
  const { data, error } = await supabase
    .from('diario')
    .select('*')
    .order('data', { ascending: false })
    .limit(30)
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

// Salva entrada do diário
app.post('/diario', async (req, res) => {
  const { conteudo, humor, data } = req.body
  const { error } = await supabase
    .from('diario')
    .insert({ conteudo, humor, data })
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Busca metas
app.get('/metas', async (req, res) => {
  const { data, error } = await supabase
    .from('metas')
    .select('*')
    .eq('ativa', true)
    .order('criado_em', { ascending: true })
  if (error) return res.status(500).json({ erro: error.message })
  res.json(data)
})

// Salva meta nova
app.post('/metas', async (req, res) => {
  const { titulo, descricao, categoria, prazo } = req.body
  const { error } = await supabase
    .from('metas')
    .insert({ titulo, descricao, categoria, prazo })
  if (error) return res.status(500).json({ erro: error.message })
  res.json({ ok: true })
})

// Atualiza análise de alinhamento no relatório
app.get('/analise', async (req, res) => {
  const { data: metas } = await supabase
    .from('metas')
    .select('*')
    .eq('ativa', true)

  const { data: eventos } = await supabase
    .from('events')
    .select('*')
    .gte('data', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])

  const { data: diario } = await supabase
    .from('diario')
    .select('*')
    .order('data', { ascending: false })
    .limit(7)

  if (!metas || metas.length === 0) {
    return res.json({ conteudo: 'Cadastre suas metas primeiro para eu poder analisar seu alinhamento.' })
  }

  const resposta = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Você é a Maya, assistente pessoal inteligente e direta.
Analise se a rotina da usuária está alinhada com suas metas.
Seja honesta, empática e prática. Máximo 250 palavras.
Estruture assim:
🎯 ALINHAMENTO — nota de 1 a 10 e por quê
✅ O QUE ESTÁ FUNCIONANDO — o que na rotina contribui para as metas
⚠️ PONTO DE ATENÇÃO — onde há desconexão entre rotina e metas
💡 AÇÃO DA SEMANA — uma coisa concreta para fazer essa semana`
        },
        {
          role: 'user',
          content: `Minhas metas: ${JSON.stringify(metas)}
Minha rotina essa semana: ${JSON.stringify(eventos)}
Meu diário recente: ${JSON.stringify(diario)}`
        }
      ]
  })

  res.json({ conteudo: resposta.choices[0].message.content })
})
app.listen(PORT, () => {
  console.log(`Maya rodando em http://localhost:${PORT}`)
})