require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })

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
Se houver conflito (menos de 30 min de diferença), adicione "conflito": true e "mensagem_conflito": "explicação e sugestão"`
        },
        { role: 'user', content: mensagem }
      ]
    })

    const texto = resposta.choices[0].message.content
    const dados = JSON.parse(texto)

    // Normaliza — transforma objeto único em array para tratar tudo igual
    const lista = Array.isArray(dados) ? dados : [dados]

    // Verifica conflito em qualquer item da lista
    const conflito = lista.find(ev => ev.conflito)
    if (conflito) {
      return res.json({
        conflito: true,
        mensagem_conflito: conflito.mensagem_conflito
      })
    }

    // Salva todos os eventos no Supabase
    const { error } = await supabase.from('events').insert(
      lista.map(ev => ({
        titulo: ev.titulo,
        tipo: ev.tipo,
        data: ev.data,
        hora: ev.hora || null
      }))
    )

    if (error) throw error

    // Retorna confirmação do primeiro evento (os outros são silenciosos)
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

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Maya rodando em http://localhost:${PORT}`)
})