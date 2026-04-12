// Carrega as variáveis do arquivo .env para o processo
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') })

// Importa os pacotes instalados
const express = require('express')
const cors = require('cors')

// Importa o cliente oficial da OpenAI
const OpenAI = require('openai')

// Cria a aplicação Express — ela vai ser o seu servidor
const app = express()

// Cria o cliente OpenAI usando a chave do .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Middlewares — são funções que rodam em toda requisição antes do seu código
app.use(cors())           // permite o browser falar com o servidor
app.use(express.json())   // permite receber dados em formato JSON
app.use(express.static('public')) // serve os arquivos da pasta public (seu HTML)

// Rota principal — quando o browser mandar POST para /chat
app.post('/chat', async (req, res) => {

  // Pega a mensagem que veio do browser
  const { mensagem, eventos } = req.body

  try {
    // Chama a API da OpenAI
    const resposta = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é a Maya, uma assistente de agenda inteligente.
Quando o usuário mandar uma mensagem, você deve:
1. Identificar se é um evento (tem hora marcada) ou tarefa (sem hora)
2. Extrair as informações e responder SEMPRE em JSON puro, sem texto extra

Formato obrigatório para evento:
{"tipo":"evento","titulo":"nome do evento","data":"YYYY-MM-DD","hora":"HH:MM","confirmacao":"mensagem amigável confirmando"}

Formato obrigatório para tarefa:
{"tipo":"tarefa","titulo":"nome da tarefa","data":"YYYY-MM-DD","confirmacao":"mensagem amigável confirmando"}

Datas relativas: hoje é ${new Date().toLocaleDateString('pt-BR', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}.
"amanhã" = dia seguinte, "quinta" = próxima quinta-feira, etc.

Eventos já existentes na agenda (para detectar conflitos):
${JSON.stringify(eventos || [])}

Se houver conflito de horário (menos de 30 minutos de diferença), adicione ao JSON:
"conflito": true, "mensagem_conflito": "explicação do conflito e sugestão de horário livre"`
        },
        {
          role: 'user',
          content: mensagem
        }
      ]
    })

    // Pega o texto da resposta
    const texto = resposta.choices[0].message.content

    // Converte de texto JSON para objeto JavaScript
    const dados = JSON.parse(texto)

    // Manda de volta para o browser
    res.json(dados)

  } catch (erro) {
    console.error('Erro:', erro)
    res.status(500).json({ erro: 'Algo deu errado' })
  }
})

// Liga o servidor na porta definida no .env
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Maya rodando em http://localhost:${PORT}`)
})