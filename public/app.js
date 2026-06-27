// Estado da aplicação
let network = null;
const nodes = new vis.DataSet();
const edges = new vis.DataSet();
let sessionRecords = {}; // Armazena os registros brutos indexados por ID do acervo
let currentSearchResults = []; // Armazena a última lista de resultados de busca na BU UFSC

// Configuração de cores para os nós
const COLORS = {
    book: {
        border: '#0ea5e9',
        background: '#0284c7',
        highlight: { border: '#38bdf8', background: '#0ea5e9' }
    },
    author: {
        border: '#f43f5e',
        background: '#e11d48',
        highlight: { border: '#fda4af', background: '#f43f5e' }
    },
    subject: {
        border: '#a855f7',
        background: '#9333ea',
        highlight: { border: '#c084fc', background: '#a855f7' }
    },
    publisher: {
        border: '#10b981',
        background: '#059669',
        highlight: { border: '#34d399', background: '#10b981' }
    }
};

// SVG de capa padrão embutido
const DEFAULT_COVER_SVG = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='170' viewBox='0 0 120 170'><rect width='120' height='170' fill='%231e293b' rx='8'/><rect x='10' y='10' width='100' height='150' fill='none' stroke='%23334155' stroke-width='2' stroke-dasharray='4' rx='4'/><text x='50%' y='45%' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='sans-serif' font-size='28'>📖</text><text x='50%' y='70%' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='10' font-weight='bold'>SEM CAPA</text></svg>`;

// Inicialização do grafo
function initNetwork() {
    const container = document.getElementById('network-canvas');
    const data = { nodes, edges };
    
    const options = {
        nodes: {
            brokenImage: DEFAULT_COVER_SVG,
            font: {
                color: '#f8fafc',
                size: 14,
                face: 'Outfit',
                strokeWidth: 2,
                strokeColor: '#0f172a'
            },
            shadow: {
                enabled: true,
                color: 'rgba(0,0,0,0.4)',
                size: 8,
                x: 0,
                y: 4
            }
        },
        edges: {
            color: {
                color: 'rgba(148, 163, 184, 0.3)',
                highlight: '#38bdf8',
                hover: '#38bdf8'
            },
            width: 1.5,
            smooth: {
                type: 'continuous',
                forceDirection: 'none'
            }
        },
        physics: {
            enabled: true,
            barnesHut: {
                gravitationalConstant: -3000,
                centralGravity: 0.3,
                springLength: 150,
                springConstant: 0.04,
                damping: 0.09,
                avoidOverlap: 1
            },
            stabilization: {
                enabled: true,
                iterations: 1000,
                updateInterval: 50,
                onlyDynamicEdges: false,
                fit: true
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            hideEdgesOnDrag: false
        }
    };
    
    network = new vis.Network(container, data, options);
    
    // Evento de clique em um nó
    network.on('click', (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            showNodeDetails(nodeId);
        } else {
            hideDetailsPanel();
        }
    });

    // Evento de duplo clique para expandir o nó (buscar conexões)
    network.on('doubleClick', async (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);
            if (!node) return;
            
            if (node.type === 'book') {
                // Ao dar duplo clique no livro, se ele não estiver totalmente enriquecido, 
                // buscamos seus detalhes completos e o atualizamos (o que expande assuntos, etc.)
                const acervoId = node.acervoId;
                const record = sessionRecords[acervoId];
                if (record && (record.publisher === 'Não informada' || !record.isbn)) {
                    const metadata = await fetchAcervoMetadata(acervoId);
                    if (metadata) {
                        addRecordToGraph(acervoId, metadata);
                    }
                }
            } else if (node.type === 'subject' || node.type === 'author') {
                // Ao dar duplo clique no assunto ou autor, apenas abrimos a busca lateral na BU
                if (node.authorityId) {
                    searchConnectionOnBU(node.name, node.authorityId, node.type);
                } else {
                    const typeLabel = node.type === 'subject' ? 'assunto' : 'autor';
                    showStatus(`Este ${typeLabel} não possui código de autoridade para busca.`, true);
                    setTimeout(hideStatus, 2000);
                }
            }
        }
    });
}

// Analisa a resposta JSON nativa do Pergamum e extrai os campos MARC relevantes
function parsePergamumJSON(data) {
    const fields = {};
    if (data?.campos) {
        data.campos.forEach(c => {
            fields[c.ordem] = c;
        });
    }

    // 1. Extração do título (MARC 245 - Título principal + Subtítulo)
    let title = 'Sem título';
    const titleField = fields['245'];
    if (titleField?.detalhes && titleField.detalhes.length > 0) {
        const det = titleField.detalhes[0];
        const idxA = det._secao.indexOf('a');
        if (idxA !== -1) {
            const mainTitle = cleanString(det.descricao[idxA]);
            let subTitle = '';
            const idxB = det._secao.indexOf('b');
            if (idxB !== -1) {
                let punct = (det.pontuacao?.[idxA]) ? det.pontuacao[idxA] : ': ';
                punct = punct.replace(/\s+/g, ' ');
                if (!punct.endsWith(' ') && punct.trim().length > 0) {
                    punct += ' ';
                }
                subTitle = punct + cleanString(det.descricao[idxB]);
            }
            title = (mainTitle + subTitle).trim().replace(/\s+/g, ' ');
        }
    }

    // 2. Extração dos autores (MARC 100 - Principal, 700 - Secundários)
    const authors = [];
    const mainAuthorField = fields['100'];
    if (mainAuthorField?.detalhes) {
        mainAuthorField.detalhes.forEach(det => {
            const idx = det._secao.indexOf('a');
            if (idx !== -1) {
                const name = cleanString(det.descricao[idx]);
                const authCode = det.cod_autoridade && det.cod_autoridade.length > 0 ? (det.cod_autoridade[idx] || det.cod_autoridade[0] || '') : '';
                if (name && !authors.some(a => a.name === name)) {
                    authors.push({ name: name, authorityId: authCode });
                }
            }
        });
    }
    const addedAuthorField = fields['700'];
    if (addedAuthorField?.detalhes) {
        addedAuthorField.detalhes.forEach(det => {
            const idx = det._secao.indexOf('a');
            if (idx !== -1) {
                const name = cleanString(det.descricao[idx]);
                const authCode = det.cod_autoridade && det.cod_autoridade.length > 0 ? (det.cod_autoridade[idx] || det.cod_autoridade[0] || '') : '';
                if (name && !authors.some(a => a.name === name)) {
                    authors.push({ name: name, authorityId: authCode });
                }
            }
        });
    }

    // 3. Extração dos assuntos (MARC 650)
    const subjects = [];
    const subjectField = fields['650'];
    if (subjectField?.detalhes) {
        subjectField.detalhes.forEach(det => {
            const idx = det._secao.indexOf('a');
            if (idx !== -1) {
                const sub = cleanString(det.descricao[idx]);
                const authCode = det.cod_autoridade && det.cod_autoridade.length > 0 ? (det.cod_autoridade[idx] || det.cod_autoridade[0] || '') : '';
                if (sub) {
                    if (!subjects.some(s => s.name === sub)) {
                        subjects.push({ name: sub, authorityId: authCode });
                    }
                }
            }
        });
    }

    // 4. Extração da editora e ano (MARC 260)
    let publisher = 'Não informada';
    let year = '';
    const pubField = fields['260'];
    if (pubField?.detalhes && pubField.detalhes.length > 0) {
        const det = pubField.detalhes[0];
        const pubIdx = det._secao.indexOf('b');
        if (pubIdx !== -1) {
            publisher = cleanString(det.descricao[pubIdx]);
        }
        const yearIdx = det._secao.indexOf('c');
        if (yearIdx !== -1) {
            // Extrai somente dígitos do ano (ex: "c2009" ou "2009." -> "2009")
            const match = det.descricao[yearIdx].match(/\d{4}/);
            year = match ? match[0] : cleanString(det.descricao[yearIdx]);
        }
    }

    // 5. Extração do ISBN (MARC 20)
    let isbn = '';
    const isbnField = fields['20'];
    if (isbnField?.detalhes) {
        for (const det of isbnField.detalhes) {
            const idx = det._secao.indexOf('a');
            if (idx !== -1) {
                const match = det.descricao[idx].match(/\d{10,13}[xX]?/);
                if (match) {
                    isbn = match[0];
                    break; // Pega o primeiro ISBN válido
                }
            }
        }
    }

    // 6. Extração do link da capa (MARC 856)
    let coverUrl = '';
    const coverField = fields['856'];
    if (coverField?.detalhes) {
        for (const det of coverField.detalhes) {
            if (det.link_acesso && (det.link_acesso.includes('/covers/') || det.link_acesso.includes('capa'))) {
                coverUrl = det.link_acesso;
                break;
            }
        }
    }

    return { title, authors, subjects, publisher, year, isbn, coverUrl };
}

// Limpa caracteres especiais comuns de dados MARC (como pontuações ao final)
function cleanString(str) {
    if (!str) return '';
    return str.trim()
              .replace(/[\s.,;:/-]+$/, '') // Remove pontuação terminal
              .trim();
}

// Busca os metadados do acervo no servidor local (que faz o proxy)
async function fetchAcervoMetadata(acervoId) {
    showStatus('Buscando dados no catálogo...', false);
    try {
        const response = await fetch(`/api/acervo/${acervoId}`);
        if (!response.ok) {
            throw new Error(`Código de erro HTTP: ${response.status}`);
        }
        const data = await response.json();
        
        // Verifica se a resposta contém dados válidos
        if (!data?.campos || data.campos.length === 0) {
            throw new Error('Nenhum registro encontrado para este código de acervo.');
        }
        
        hideStatus();
        const metadata = parsePergamumJSON(data);
        
        // Se não houver capa na tag 856, mas houver ISBN, busca dinamicamente em capas.bu.ufsc.br
        if (!metadata.coverUrl && metadata.isbn) {
            try {
                const coverRes = await fetch(`https://capas.bu.ufsc.br/cover?id=${metadata.isbn}`);
                if (coverRes.ok) {
                    const coverData = await coverRes.json();
                    if (coverData?.[metadata.isbn]) {
                        metadata.coverUrl = coverData[metadata.isbn];
                    }
                }
            } catch (e) {
                console.warn('Erro ao carregar capa dinâmica da BU:', e);
            }
        }
        
        return metadata;
    } catch (error) {
        console.error(error);
        showStatus(`Erro: ${error.message}`, true);
        return null;
    }
}

// Adiciona um livro e suas conexões ao Grafo
function addRecordToGraph(acervoId, metadata) {
    const bookNodeId = `book_${acervoId}`;
    
    // Armazena no estado da sessão
    sessionRecords[acervoId] = { id: acervoId, ...metadata };

    // Determina a imagem da capa (usando o link direto se houver ou o serviço oficial de capas como fallback)
    let coverUrl = DEFAULT_COVER_SVG;
    let shape = 'box';
    if (metadata.coverUrl) {
        coverUrl = metadata.coverUrl;
        shape = 'circularImage';
    } else if (metadata.isbn) {
        // Usamos o link do Coce capas.bu.ufsc.br
        coverUrl = `https://capas.bu.ufsc.br/cover?id=${metadata.isbn}&provider=aws,gb,ol`;
        shape = 'circularImage';
    }

    // 1. Adiciona ou atualiza o nó da obra
    // Limita o título no gráfico a 60 caracteres + '...' para evitar rótulos gigantescos
    const maxGraphTitleLength = 60;
    let graphLabel = metadata.title;
    if (graphLabel.length > maxGraphTitleLength) {
        graphLabel = `${graphLabel.substring(0, maxGraphTitleLength).trim()}...`;
    }

    const bookNode = {
        id: bookNodeId,
        label: breakText(graphLabel, 20),
        shape: shape,
        image: coverUrl,
        size: 30,
        color: COLORS.book,
        borderWidth: 3,
        type: 'book',
        acervoId: acervoId,
        font: { size: 14, bold: true }
    };

    if (nodes.get(bookNodeId)) {
        nodes.update(bookNode);
    } else {
        nodes.add(bookNode);
    }

    // 2. Processa Autores
    metadata.authors.forEach(authorObj => {
        const author = authorObj.name;
        const authId = authorObj.authorityId;
        const authorNodeId = `author_${author.toLowerCase().replace(/\s+/g, '_')}`;
        
        // Adiciona nó do Autor se não existir
        if (!nodes.get(authorNodeId)) {
            nodes.add({
                id: authorNodeId,
                label: author,
                shape: 'dot',
                size: 15,
                color: COLORS.author,
                type: 'author',
                name: author,
                authorityId: authId
            });
        }

        // Conecta o Livro ao Autor
        const edgeId = `edge_${bookNodeId}_${authorNodeId}`;
        if (!edges.get(edgeId)) {
            edges.add({ id: edgeId, from: bookNodeId, to: authorNodeId });
        }
    });

    // 3. Processa assuntos
    metadata.subjects.forEach(subjectObj => {
        const subject = subjectObj.name;
        const authId = subjectObj.authorityId;
        const subjectNodeId = `subject_${subject.toLowerCase().replace(/\s+/g, '_')}`;
        
        // Adiciona nó do assunto se não existir
        if (!nodes.get(subjectNodeId)) {
            nodes.add({
                id: subjectNodeId,
                label: subject,
                shape: 'dot',
                size: 20, // Assuntos são maiores
                color: COLORS.subject,
                type: 'subject',
                name: subject,
                authorityId: authId
            });
        }

        // Conecta a obra ao assunto
        const edgeId = `edge_${bookNodeId}_${subjectNodeId}`;
        if (!edges.get(edgeId)) {
            edges.add({ id: edgeId, from: bookNodeId, to: subjectNodeId });
        }
    });

    // 4. Processa editora
    if (metadata.publisher && metadata.publisher !== 'Não informada') {
        const pub = metadata.publisher;
        const pubNodeId = `publisher_${pub.toLowerCase().replace(/\s+/g, '_')}`;
        
        // Adiciona nó da editora se não existir
        if (!nodes.get(pubNodeId)) {
            nodes.add({
                id: pubNodeId,
                label: pub,
                shape: 'dot',
                size: 12,
                color: COLORS.publisher,
                type: 'publisher',
                name: pub
            });
        }

        // Conecta a obra à editora
        const edgeId = `edge_${bookNodeId}_${pubNodeId}`;
        if (!edges.get(edgeId)) {
            edges.add({ id: edgeId, from: bookNodeId, to: pubNodeId });
        }
    }

    // Foca a câmera no novo livro adicionado
    setTimeout(() => {
        network.focus(bookNodeId, {
            scale: 0.9,
            animation: {
                duration: 1000,
                easingFunction: 'easeInOutQuad'
            }
        });
        showNodeDetails(bookNodeId);
    }, 200);
}

// Quebra textos longos em várias linhas para os labels dos nós
function breakText(text, maxChars) {
    if (text.length <= maxChars) return text;
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';
    
    words.forEach(word => {
        if ((`${currentLine} ${word}`).trim().length <= maxChars) {
            currentLine = (`${currentLine} ${word}`).trim();
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    });
    if (currentLine) lines.push(currentLine);
    
    return lines.join('\n');
}

// Exibe informações do nó no painel lateral
function showNodeDetails(nodeId) {
    const node = nodes.get(nodeId);
    if (!node) return;

    const panel = document.getElementById('details-panel');
    const bookSec = document.getElementById('book-details');
    const genericSec = document.getElementById('generic-details');
    
    panel.classList.remove('hidden');

    if (node.type === 'book') {
        // Exibe seção da obra
        bookSec.classList.remove('hidden');
        genericSec.classList.add('hidden');
        
        document.getElementById('detail-type-title').innerText = 'Dados da obra';
        
        const record = sessionRecords[node.acervoId];
        
        // Se temos apenas dados básicos da obra, faz o fetch completo em segundo plano para enriquecer!
        if (record && (record.publisher === 'Não informada' || !record.isbn)) {
            fetchAcervoMetadata(node.acervoId).then(fullMeta => {
                if (fullMeta) {
                    sessionRecords[node.acervoId] = { id: node.acervoId, ...fullMeta };
                    
                    // Atualiza a barra lateral caso o nó ainda seja o selecionado
                    const activeSelection = network.getSelectedNodes();
                    if (activeSelection.length > 0 && activeSelection[0] === nodeId) {
                        document.getElementById('detail-isbn').innerText = fullMeta.isbn || 'Não consta';
                        document.getElementById('detail-publisher').innerText = fullMeta.publisher || 'Não informada';
                        document.getElementById('detail-year').innerText = fullMeta.year || 'Não informado';
                        
                        const coverImg = document.getElementById('detail-cover');
                        if (fullMeta.coverUrl) {
                            coverImg.src = fullMeta.coverUrl;
                        } else if (fullMeta.isbn) {
                            coverImg.src = `https://capas.bu.ufsc.br/cover?id=${fullMeta.isbn}&provider=gb,ol`;
                        }
                    }
                    
                    // Se o livro possui capa agora, atualiza o nó no grafo para usar a capa circular
                    if (fullMeta.coverUrl || fullMeta.isbn) {
                        nodes.update({
                            id: nodeId,
                            shape: 'circularImage',
                            image: fullMeta.coverUrl || `https://capas.bu.ufsc.br/cover?id=${fullMeta.isbn}&provider=gb,ol`
                        });
                    }
                }
            });
        }
        
        if (record) {
            document.getElementById('detail-title').innerText = record.title;
            document.getElementById('detail-acervo-id').innerText = record.id;
            document.getElementById('detail-isbn').innerText = record.isbn || 'Carregando...';
            document.getElementById('detail-publisher').innerText = record.publisher || 'Carregando...';
            document.getElementById('detail-year').innerText = record.year || 'Carregando...';
            
            const coverImg = document.getElementById('detail-cover');
            if (record.coverUrl) {
                coverImg.src = record.coverUrl;
            } else if (record.isbn) {
                coverImg.src = `https://capas.bu.ufsc.br/cover?id=${record.isbn}&provider=gb,ol`;
            } else {
                coverImg.src = DEFAULT_COVER_SVG;
            }
        }
    } else {
        // Exibe seção de outro nó (autor, assunto ou editora)
        bookSec.classList.add('hidden');
        genericSec.classList.remove('hidden');
        
        document.getElementById('detail-type-title').innerText = 'Dados de conexão';
        
        // Define o tipo
        const badge = document.getElementById('detail-badge-type');
        badge.innerText = node.type;
        badge.className = `detail-badge ${node.type}`;
        
        document.getElementById('detail-name').innerText = node.name;
        
        // Lógica específica para assuntos e autores (com botão de busca na BU)
        const searchBox = document.getElementById('subject-search-box');
        const resultsWrapper = document.getElementById('bu-search-results-wrapper');
        const searchBtn = document.getElementById('btn-search-bu');
        
        // Garante que o botão mágico está oculto ao selecionar um novo nó
        const magicBtn = document.getElementById('btn-magic-choose');
        if (magicBtn) magicBtn.classList.add('hidden');
        
        if ((node.type === 'subject' || node.type === 'author') && node.authorityId) {
            searchBox.classList.remove('hidden');
            resultsWrapper.classList.add('hidden'); // Oculta até que o usuário clique para buscar
            
            if (node.type === 'subject') {
                searchBtn.innerText = '🔍 Buscar obras deste assunto na BU';
            } else {
                searchBtn.innerText = '🔍 Buscar obras deste autor na BU';
            }
            
            searchBtn.onclick = () => {
                searchConnectionOnBU(node.name, node.authorityId, node.type);
            };
        } else {
            searchBox.classList.add('hidden');
            resultsWrapper.classList.add('hidden');
        }
        
        // Encontra livros conectados no grafo atual
        const list = document.getElementById('connected-books-list');
        list.innerHTML = '';
        
        // Percorre todas as arestas conectadas a este nó
        const connectedEdges = edges.get({
            filter: (item) => item.from === nodeId || item.to === nodeId
        });
        
        connectedEdges.forEach(edge => {
            const targetId = edge.from === nodeId ? edge.to : edge.from;
            const targetNode = nodes.get(targetId);
            
            if (targetNode && targetNode.type === 'book') {
                const li = document.createElement('li');
                const rawRecord = sessionRecords[targetNode.acervoId];
                li.innerText = rawRecord ? rawRecord.title : targetNode.label.replace('\n', ' ');
                li.onclick = () => {
                    network.focus(targetId, { scale: 1.0, animation: { duration: 500 } });
                    network.selectNodes([targetId]);
                    showNodeDetails(targetId);
                };
                list.appendChild(li);
            }
        });
    }
}
// Busca livros de um determinado assunto ou autor na BU UFSC através da API de busca
async function searchConnectionOnBU(name, authorityId, type) {
    const list = document.getElementById('bu-books-list');
    list.innerHTML = '<li style="cursor: default; background: transparent; border: none;">Buscando na base da BU UFSC...</li>';
    document.getElementById('bu-search-results-wrapper').classList.remove('hidden');

    try {
        const coluna = type === 'author' ? 'INDICE_3' : 'INDICE_2';
        const response = await fetch(`/api/pesquisa?termo=${encodeURIComponent(name)}&indice=${authorityId}&coluna=${coluna}`);
        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }
        const data = await response.json();
        
        list.innerHTML = '';
        currentSearchResults = [];
        
        if (data && Array.isArray(data) && data.length > 0) {
            currentSearchResults = data.filter(item => item.cod_acervo);
            const magicBtn = document.getElementById('btn-magic-choose');
            if (magicBtn) {
                if (currentSearchResults.length > 0) {
                    magicBtn.classList.remove('hidden');
                } else {
                    magicBtn.classList.add('hidden');
                }
            }
            data.forEach(item => {
                const acervoId = item.cod_acervo;
                const title = item.descricao || item.obra;
                
                if (acervoId) {
                    const li = document.createElement('li');
                    li.style.display = 'flex';
                    li.style.justifyContent = 'space-between';
                    li.style.alignItems = 'center';
                    li.style.gap = '10px';
                    
                    const titleSpan = document.createElement('span');
                    titleSpan.innerText = title;
                    titleSpan.style.flexGrow = '1';
                    titleSpan.style.wordBreak = 'break-word';
                    
                    const addIcon = document.createElement('span');
                    addIcon.className = 'bu-add-icon';
                    addIcon.innerText = '＋';
                    addIcon.title = 'Adicionar este acervo ao grafo';
                    
                    li.appendChild(titleSpan);
                    li.appendChild(addIcon);
                    
                    li.onclick = async (e) => {
                        e.stopPropagation();
                        const bookId = `book_${acervoId}`;
                        if (nodes.get(bookId)) {
                            // Já está no grafo, apenas foca
                            network.focus(bookId, { scale: 1.0, animation: { duration: 500 } });
                            network.selectNodes([bookId]);
                            showNodeDetails(bookId);
                        } else {
                            // Busca metadados completos do acervo e adiciona ao grafo
                            const metadata = await fetchAcervoMetadata(acervoId);
                            if (metadata) {
                                addRecordToGraph(acervoId, metadata);
                            }
                        }
                    };
                    
                    list.appendChild(li);
                }
            });
        } else {
            const magicBtn = document.getElementById('btn-magic-choose');
            if (magicBtn) magicBtn.classList.add('hidden');
            const typeLabel = type === 'author' ? 'autor' : 'assunto';
            list.innerHTML = `<li style="cursor: default; background: transparent; border: none;">Nenhum livro encontrado para este ${typeLabel} na BU.</li>`;
        }
    } catch (err) {
        const magicBtn = document.getElementById('btn-magic-choose');
        if (magicBtn) magicBtn.classList.add('hidden');
        console.error(err);
        list.innerHTML = `<li style="color: #ef4444; cursor: default; background: transparent; border: none;">Erro ao buscar: ${err.message}</li>`;
    }
}

// Expande o assunto diretamente no grafo, buscando obras relacionadas na BU UFSC
// e adicionando-as de forma conectada, junto com seus coautores e outros assuntos.
async function _expandSubjectInGraph(subjectName, authorityId, subjectNodeId) {
    showStatus('Buscando e desenhando conexões da BU...', false);
    try {
        const response = await fetch(`/api/pesquisa?termo=${encodeURIComponent(subjectName)}&indice=${authorityId}`);
        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }
        const data = await response.json();
        hideStatus();
        
        if (data && Array.isArray(data) && data.length > 0) {
            let addedCount = 0;
            data.forEach(item => {
                const acervoId = item.cod_acervo;
                if (!acervoId) return;
                
                addedCount++;
                const title = cleanString(item.obra || item.descricao);
                const bookNodeId = `book_${acervoId}`;
                
                // 1. Adiciona nó da obra (inicialmente como box)
                if (!nodes.get(bookNodeId)) {
                    // Limita o título no gráfico a 60 caracteres + '...' para evitar rótulos gigantescos
                    const maxGraphTitleLength = 60;
                    let graphLabel = title;
                    if (graphLabel.length > maxGraphTitleLength) {
                        graphLabel = `${graphLabel.substring(0, maxGraphTitleLength).trim()}...`;
                    }
                    nodes.add({
                        id: bookNodeId,
                        label: breakText(graphLabel, 20),
                        shape: 'box',
                        color: COLORS.book,
                        borderWidth: 3,
                        type: 'book',
                        acervoId: acervoId,
                        font: { size: 14, bold: true }
                    });
                }
                
                // Cria ou complementa metadados na sessão (caso o usuário queira clicar nele para ver os dados da obra)
                if (!sessionRecords[acervoId]) {
                    sessionRecords[acervoId] = {
                        id: acervoId,
                        title: title,
                        authors: [],
                        subjects: [],
                        publisher: 'Não informada',
                        year: item.ano_publicacao || '',
                        isbn: ''
                    };
                }
                
                // Conecta o livro ao assunto de origem
                const mainEdgeId = `edge_${bookNodeId}_${subjectNodeId}`;
                if (!edges.get(mainEdgeId)) {
                    edges.add({ id: mainEdgeId, from: bookNodeId, to: subjectNodeId });
                }
                
                // 2. Adiciona autores desta obra retornados na busca
                if (item.dados_adicionais?.A) {
                    item.dados_adicionais.A.forEach(a => {
                        const authorName = cleanString(a.descricao);
                        const authorId = a.codigo;
                        const authorNodeId = `author_${authorName.toLowerCase().replace(/\s+/g, '_')}`;
                        
                        if (!nodes.get(authorNodeId)) {
                            nodes.add({
                                id: authorNodeId,
                                label: authorName,
                                shape: 'dot',
                                size: 15,
                                color: COLORS.author,
                                type: 'author',
                                name: authorName,
                                authorityId: authorId
                            });
                        }
                        
                        const edgeId = `edge_${bookNodeId}_${authorNodeId}`;
                        if (!edges.get(edgeId)) {
                            edges.add({ id: edgeId, from: bookNodeId, to: authorNodeId });
                        }
                        
                        if (!sessionRecords[acervoId].authors.some(auth => auth.name === authorName)) {
                            sessionRecords[acervoId].authors.push({ name: authorName, authorityId: authorId });
                        }
                    });
                }
                
                // 3. Adiciona outros assuntos deste acervo retornados na busca
                if (item.dados_adicionais?.S) {
                    item.dados_adicionais.S.forEach(s => {
                        const sName = cleanString(s.descricao);
                        const sId = s.codigo;
                        const sNodeId = `subject_${sName.toLowerCase().replace(/\s+/g, '_')}`;
                        
                        if (!nodes.get(sNodeId)) {
                            nodes.add({
                                id: sNodeId,
                                label: sName,
                                shape: 'dot',
                                size: 20,
                                color: COLORS.subject,
                                type: 'subject',
                                name: sName,
                                authorityId: sId
                            });
                        }
                        
                        const edgeId = `edge_${bookNodeId}_${sNodeId}`;
                        if (!edges.get(edgeId)) {
                            edges.add({ id: edgeId, from: bookNodeId, to: sNodeId });
                        }
                        
                        if (!sessionRecords[acervoId].subjects.some(sub => sub.name === sName)) {
                            sessionRecords[acervoId].subjects.push({ name: sName, authorityId: sId });
                        }
                    });
                }
            });
            
            showStatus(`Grafo expandido com ${addedCount} novos livros da BU!`, false);
            setTimeout(hideStatus, 2500);
        } else {
            showStatus('Nenhum acervo retornado pela busca da BU.', true);
            setTimeout(hideStatus, 3000);
        }
    } catch (err) {
        console.error(err);
        showStatus(`Erro na expansão: ${err.message}`, true);
        setTimeout(hideStatus, 3000);
    }
}

function hideDetailsPanel() {
    document.getElementById('details-panel').classList.add('hidden');
}

// Controle de mensagens de status
function showStatus(text, isError = false) {
    const msg = document.getElementById('status-message');
    const spinner = msg.querySelector('.spinner');
    const textEl = msg.querySelector('.status-text');
    
    msg.classList.remove('hidden', 'error');
    textEl.innerText = text;
    
    if (isError) {
        msg.classList.add('error');
        spinner.classList.add('hidden');
    } else {
        spinner.classList.remove('hidden');
    }
}

function hideStatus() {
    document.getElementById('status-message').classList.add('hidden');
}

// Listeners de UI
document.getElementById('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('acervo-id');
    const acervoId = input.value.trim();
    
    if (!acervoId || !/^\d+$/.test(acervoId)) {
        showStatus('Por favor, digite um código de acervo numérico válido.', true);
        return;
    }
    
    const merge = document.getElementById('merge-graphs').checked;
    
    if (!merge) {
        nodes.clear();
        edges.clear();
        sessionRecords = {};
        hideDetailsPanel();
    }
    
    // Verifica se o livro já existe no grafo (evita requisições repetidas)
    if (nodes.get(`book_${acervoId}`)) {
        showStatus('Este livro já está no grafo!', false);
        setTimeout(hideStatus, 2000);
        network.focus(`book_${acervoId}`, { scale: 1.0, animation: { duration: 500 } });
        network.selectNodes([`book_${acervoId}`]);
        showNodeDetails(`book_${acervoId}`);
        input.value = '';
        return;
    }
    
    const metadata = await fetchAcervoMetadata(acervoId);
    if (metadata) {
        addRecordToGraph(acervoId, metadata);
        input.value = '';
    }
});

// Botão de Centralizar
document.getElementById('btn-fit').onclick = () => {
    network.fit({ animation: { duration: 500 } });
};

// Botão de Física
const physicsBtn = document.getElementById('btn-physics');
physicsBtn.onclick = () => {
    const isPhysicsEnabled = network.physics.options.enabled;
    network.setOptions({ physics: { enabled: !isPhysicsEnabled } });
    
    if (!isPhysicsEnabled) {
        physicsBtn.classList.add('active');
    } else {
        physicsBtn.classList.remove('active');
    }
};

// Botão de Limpar
document.getElementById('btn-clear').onclick = () => {
    if (confirm('Deseja limpar todo o grafo da sessão?')) {
        nodes.clear();
        edges.clear();
        sessionRecords = {};
        hideDetailsPanel();
        hideStatus();
    }
};

// Botão de Fechar Painel Lateral
document.getElementById('btn-close-panel').onclick = hideDetailsPanel;

// Botão Mágico - Escolha para mim
document.getElementById('btn-magic-choose').onclick = async () => {
    if (currentSearchResults.length === 0) return;
    
    // Filtra as obras que ainda não estão no grafo
    let availableWorks = currentSearchResults.filter(item => !nodes.get(`book_${item.cod_acervo}`));
    
    if (availableWorks.length === 0) {
        showStatus('Todas as obras já estão no grafo! Selecionando uma aleatória...', false);
        availableWorks = currentSearchResults;
        setTimeout(hideStatus, 1500);
    } else {
        showStatus('✨ O algoritmo escolheu uma obra para você!', false);
        setTimeout(hideStatus, 1500);
    }
    
    // Escolhe uma aleatória
    const chosen = availableWorks[Math.floor(Math.random() * availableWorks.length)];
    const acervoId = chosen.cod_acervo;
    const bookId = `book_${acervoId}`;
    
    // Efeito de piscar o item na lista da barra lateral para dar feedback visual
    const listItems = document.getElementById('bu-books-list').getElementsByTagName('li');
    for (const li of listItems) {
        if (li.innerText.includes(chosen.descricao || chosen.obra)) {
            li.style.transition = 'all 0.3s ease';
            li.style.backgroundColor = 'rgba(168, 85, 247, 0.4)'; // Destaque roxo mágico
            li.style.borderColor = '#c084fc';
            setTimeout(() => {
                li.style.backgroundColor = '';
                li.style.borderColor = '';
            }, 1000);
            break;
        }
    }
    
    if (nodes.get(bookId)) {
        network.focus(bookId, { scale: 1.0, animation: { duration: 500 } });
        network.selectNodes([bookId]);
        showNodeDetails(bookId);
    } else {
        const metadata = await fetchAcervoMetadata(acervoId);
        if (metadata) {
            addRecordToGraph(acervoId, metadata);
        }
    }
};

// Botão de Exportar JSON
document.getElementById('btn-export-json').onclick = () => {
    if (Object.keys(sessionRecords).length === 0) {
        alert('Nenhum dado para exportar ainda!');
        return;
    }
    const dataStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(sessionRecords, null, 2))}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `pergamum_grafo_sessao_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
};



// Inicialização da página
window.onload = async () => {
    initNetwork();
    
    // Verifica se há um código de acervo na URL (ex: ?acervo=286946)
    const urlParams = new URLSearchParams(window.location.search);
    const codAcervo = urlParams.get('acervo');
    if (codAcervo && /^\d+$/.test(codAcervo.trim())) {
        const cleanedId = codAcervo.trim();
        const metadata = await fetchAcervoMetadata(cleanedId);
        if (metadata) {
            addRecordToGraph(cleanedId, metadata);
        }
    }
};
