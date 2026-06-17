# Pergamum Graph Explorer (BU UFSC)

![Interface do Pergamum Graph Explorer](imagem.png)

Um explorador visual e interativo de conexões para o acervo da Biblioteca Universitária da Universidade Federal de Santa Catarina (BU UFSC). Esta ferramenta permite carregar fichas bibliográficas e navegar pelas relações de **Autores**, **Assuntos** e **Editoras** por meio de um grafo de rede dinâmico.

---

## 🚀 Como Funciona

1. **Adição por Código**: Insira o ID de um acervo (ex: `267587` para Cálculo, ou `356805` para *Deep Work*) para desenhar o nó do livro no grafo.
2. **Conexões Automáticas**: O sistema lê os campos MARC21 do livro e cria conexões visuais com seus:
   - **Autores** (nós rosa/coral, extraídos dos campos MARC `100` e `700`)
   - **Assuntos** (nós roxos, extraídos do campo MARC `650`)
   - **Editora** (nós verdes, extraídos do campo MARC `260`)
3. **Fusão de Grafos**: Se você ativar a opção "Mesclar no Grafo da Sessão", novos livros adicionados que compartilhem autores, assuntos ou editoras se conectarão automaticamente aos nós existentes.
4. **Navegação Lateral**: Ao clicar ou dar duplo clique em um nó de Assunto ou Autor, o painel lateral permite buscar novas obras relacionadas diretamente na base real da BU UFSC e adicioná-las ao grafo com um clique em `＋`.

---

## 🔍 Comportamento da Busca por Assuntos (Campos MARC21)

> [!IMPORTANT]  
> A busca por conexões de **Assunto** utiliza a API geral do Pergamum. É importante destacar que a consulta por um termo de assunto pode retornar registros onde esse termo aparece indexado em **diversos campos MARC21** (como no título `245`, notas gerais `5XX` ou resumo), e não exclusivamente no campo dedicado a assunto (`650`). 
>
> Esse comportamento é nativo do motor de busca do Pergamum UFSC e foi mantido no explorador de grafos pois enriquece a descoberta de materiais correlatos que abordam o tema, mesmo que a catalogação principal do livro utilize tags de assunto ligeiramente diferentes.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend**: HTML5, CSS3 (com design Dark Glassmorphism moderno e responsivo) e JavaScript (Vanilla).
- **Visualização de Rede**: [Vis-Network](https://visjs.github.io/vis-network/docs/network/) para renderização dinâmica e física interativa das conexões.
- **Backend**: Python 3 (usando a biblioteca nativa `http.server` para servir os arquivos e atuar como proxy CORS transparente para a API da UFSC).

---

## 💻 Como Executar Localmente

1. Certifique-se de ter o Python 3 instalado no sistema.
2. Abra um terminal na pasta do projeto e inicie o servidor:
   ```bash
   python server.py
   ```
3. Acesse no seu navegador: [http://localhost:3000](http://localhost:3000)

---

## 📝 Licença

Este projeto é de uso livre para fins educacionais e de pesquisa bibliográfica.
