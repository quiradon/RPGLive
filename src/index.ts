import Fastify from 'fastify';
import { WebSocketServer } from 'ws';

const fastify = Fastify();
const wss = new WebSocketServer({ noServer: true });
let counts: { [key: string]: number } = {}; // Armazena contagens individuais para cada overlay

// Rota do dashboard (incrementa e decrementa o valor via WebSocket)
fastify.get('/dashboard', async (request, reply) => {
  reply.type('text/html').send(`
    <html>
      <body>
        <h1>Dashboard</h1>
        <button onclick="syncOverlays()">Sincronizar</button>
        <div id="overlays"></div>
        <script>
          let ws;
          function connectWebSocket() {
            ws = new WebSocket('ws://localhost:3000/ws');
            ws.onmessage = (event) => {
              const data = JSON.parse(event.data);
              if (data.overlays !== undefined) {
                const overlaysDiv = document.getElementById('overlays');
                overlaysDiv.innerHTML = '';
                data.overlays.forEach(overlay => {
                  const overlayDiv = document.createElement('div');
                  overlayDiv.innerHTML = \`
                    Overlay \${overlay.id}:
                    <button onclick="changeCount('\${overlay.id}', 1)">+</button>
                    <button onclick="changeCount('\${overlay.id}', -1)">-</button>
                    Count: <span id="count-\${overlay.id}">\${overlay.count}</span>
                  \`;
                  overlaysDiv.appendChild(overlayDiv);
                });
              }
            };
            ws.onclose = () => {
              console.log('WebSocket closed, attempting to reconnect in 5 seconds...');
              setTimeout(connectWebSocket, 5000);
            };
          }

          function changeCount(id, delta) {
            ws.send(JSON.stringify({ id, delta }));
          }

          function syncOverlays() {
            ws.send(JSON.stringify({ action: 'sync' }));
          }

          connectWebSocket();
        </script>
      </body>
    </html>
  `);
});

// Rota do overlay (mostra o valor atualizado)
fastify.get('/overlay/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!counts[id]) {
    counts[id] = 0; // Inicializa a contagem para o ID se não existir
  }
  reply.type('text/html').send(`
    <html>
      <body>
        <h1>Overlay ${id}</h1>
        <div>Count: <span id="count">${counts[id]}</span></div>
        <script>
          let ws;
          function connectWebSocket() {
            ws = new WebSocket('ws://localhost:3000/ws');
            ws.onmessage = (event) => {
              const data = JSON.parse(event.data);
              if (data.id === '${id}' && data.count !== undefined) {
                document.getElementById('count').textContent = data.count;
              }
            };
            ws.onclose = () => {
              console.log('WebSocket closed, attempting to reconnect in 5 seconds...');
              setTimeout(connectWebSocket, 5000);
            };
          }

          connectWebSocket();
        </script>
      </body>
    </html>
  `);
});

// Configurando WebSocket com ws diretamente
fastify.server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const { id, delta, action } = JSON.parse(message.toString());
    if (action === 'sync') {
      // Envia a lista de overlays para o cliente que solicitou a sincronização
      ws.send(JSON.stringify({ overlays: Object.keys(counts).map(key => ({ id: key, count: counts[key] })) }));
    } else if (delta !== undefined && counts[id] !== undefined) {
      counts[id] += delta;
    }

    // Envia o novo valor para todos os clientes conectados
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ id, count: counts[id], overlays: Object.keys(counts).map(key => ({ id: key, count: counts[key] })) }));
      }
    });
  });

  // Envia a lista de overlays para o novo cliente
  ws.send(JSON.stringify({ overlays: Object.keys(counts).map(key => ({ id: key, count: counts[key] })) }));
});

fastify.listen({ port: 3000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server running at ${address}`);
});