import express from 'express';
import fetch from 'node-fetch';
import querystring from 'querystring';
import path from 'path';
import { fileURLToPath } from 'url';

// Implementación de la estructura de datos Cola
class Cola {
    constructor() {
        this.canciones = [];
    }

    enqueue(cancion) {
        this.canciones.push(cancion);
    }

    dequeue() {
        if (this.canciones.length === 0) {
            return null;
        }
        // En lugar de eliminar, mover al final
        const cancion = this.canciones.shift();
        this.canciones.push(cancion);
        console.log(`Reproduciendo: ${cancion.name}`);
        return cancion;
    }

    mostrar() {
        return [...this.canciones];
    }

    isEmpty() {
        return this.canciones.length === 0;
    }

    async actualizarCanciones(accessToken) {
        try {
            const response = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=10', {
                headers: {
                    'Authorization': 'Bearer ' + accessToken
                }
            });
            const data = await response.json();
            
            // Limpiar la cola y resetear las reproducidas
            this.canciones = [];
            
            data.items.forEach(track => {
                this.enqueue({
                    name: track.name,
                    artist: track.artists[0].name,
                    url: track.external_urls.spotify,
                    imageUrl: track.album.images[0].url
                });
            });
            return this.mostrar();
        } catch (error) {
            console.error('Error al actualizar canciones:', error);
            throw error;
        }
    }

    moverAlFinal(url) {
        const index = this.canciones.findIndex(cancion => cancion.url === url);
        if (index > -1) {
            const [cancion] = this.canciones.splice(index, 1);
            this.canciones.push(cancion);
            console.log(`Movida al final: ${cancion.name}`);
            return this.mostrar();
        }
        return null;
    }

    setPrioridad(url) {
        const index = this.canciones.findIndex(cancion => cancion.url === url);
        if (index > -1) {
            // Remover la canción de su posición actual
            const [cancion] = this.canciones.splice(index, 1);
            // Añadirla al principio de la cola
            this.canciones.unshift(cancion);
            console.log(`Prioridad establecida para: ${cancion.name}`);
            return this.mostrar();
        }
        return null;
    }

    eliminarCancion(url) {
        const index = this.canciones.findIndex(cancion => cancion.url === url);
        if (index > -1) {
            const [cancionEliminada] = this.canciones.splice(index, 1);
            console.log(`Canción eliminada: ${cancionEliminada.name}`);
            return this.mostrar();
        }
        return null;
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 8888;
const colaCanciones = new Cola();

// Servir archivos estáticos desde la carpeta public
app.use(express.static('public'));

const clientId = '3f4dc063df694d53b5e668cff24affbe';
const clientSecret = 'b8a3df837f8847acb54bfca2c894df85';
const redirectUri = 'http://localhost:8888/callback';

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    const scope = 'user-top-read user-read-private user-read-email';
    const authUrl = 'https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: clientId,
            scope: scope,
            redirect_uri: redirectUri
        });
    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    
    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
            },
            body: querystring.stringify({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri
            })
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        res.redirect('/?access_token=' + data.access_token);
    } catch (error) {
        console.error('Error:', error);
        res.redirect('/?error=auth_failed');
    }
});

app.get('/top-tracks', async (req, res) => {
    const accessToken = req.query.access_token;
    try {
        const response = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=10', {
            headers: {
                'Authorization': 'Bearer ' + accessToken
            }
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message);
        }

        // Limpiar la cola anterior
        colaCanciones.canciones = [];

        // Agregar las nuevas canciones a la cola
        data.items.forEach(track => {
            colaCanciones.enqueue({
                name: track.name,
                artist: track.artists[0].name,
                url: track.external_urls.spotify,
                imageUrl: track.album.images[0].url // Agregamos la URL de la imagen
            });
        });

        res.json(colaCanciones.mostrar());
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener las canciones' });
    }
});

// Modificar el endpoint /queue para manejar la actualización
app.get('/queue', async (req, res) => {
    const accessToken = req.query.access_token;
    const actualizar = req.query.update === 'true';

    if (actualizar && accessToken) {
        try {
            const canciones = await colaCanciones.actualizarCanciones(accessToken);
            res.json(canciones);
        } catch (error) {
            console.error('Error al actualizar canciones:', error);
            res.status(500).json({ error: 'Error al actualizar las canciones' });
        }
    } else {
        res.json(colaCanciones.mostrar());
    }
});

// Modificar el endpoint /queue/next para verificar si la cola está vacía
app.get('/queue/next', (req, res) => {
    const nextSong = colaCanciones.dequeue();
    if (nextSong) {
        // Enviamos la canción con todos sus datos incluida la imagen
        res.json({
            cancion: nextSong,
            restantes: colaCanciones.canciones.length,
            mensaje: `Reproduciendo: ${nextSong.name}`
        });
    } else {
        // No hay más canciones
        res.status(404).json({ 
            error: 'No hay canciones en la cola',
            necesitaActualizar: true
        });
    }
});

app.post('/queue', express.json(), (req, res) => {
    const cancion = req.body;
    colaCanciones.enqueue(cancion);
    res.status(201).json(cancion);
});

// Modificar el endpoint para manejar la reproducción individual
app.post('/queue/play', express.json(), (req, res) => {
    const { url } = req.body;
    const canciones = colaCanciones.moverAlFinal(url);
    if (canciones) {
        res.json({
            mensaje: 'Canción movida al final de la cola',
            restantes: canciones.length,
            canciones: canciones
        });
    } else {
        res.status(404).json({ error: 'Canción no encontrada' });
    }
});

// Añadir nuevo endpoint para manejar la prioridad
app.post('/queue/priority', express.json(), (req, res) => {
    const { url } = req.body;
    const canciones = colaCanciones.setPrioridad(url);
    if (canciones) {
        res.json({
            mensaje: 'Prioridad establecida',
            canciones: canciones
        });
    } else {
        res.status(404).json({ error: 'Canción no encontrada' });
    }
});

// Añadir endpoint para eliminar canción
app.delete('/queue/delete', express.json(), (req, res) => {
    const { url } = req.body;
    const canciones = colaCanciones.eliminarCancion(url);
    if (canciones) {
        res.json({
            mensaje: 'Canción eliminada de la cola',
            restantes: canciones.length,
            canciones: canciones
        });
    } else {
        res.status(404).json({ error: 'Canción no encontrada' });
    }
});

app.get('/me', async (req, res) => {
    const accessToken = req.query.access_token;
    try {
        const response = await fetch('https://api.spotify.com/v1/me', {
            headers: {
                'Authorization': 'Bearer ' + accessToken
            }
        });
        const data = await response.json();
        res.json({
            name: data.display_name,
            totalCanciones: 10
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener información del usuario' });
    }
});

app.listen(port, () => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});