import { expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
export async function verifyPrivateMedia({ teacher, a, b, rooms, errors = [] }) {
    expect(rooms).toHaveLength(2);
    expect(rooms[0].room_id).not.toBe(rooms[1].room_id);
    await teacher.evaluate(async (calls) => {
        const audit = [];
        window.privateVideoAudit = audit;
        for (const [index, call] of calls.entries()) {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 240;
            const drawing = canvas.getContext('2d'), color = index === 0 ? 'rgb(224,24,24)' : 'rgb(24,24,224)';
            const draw = () => { drawing.fillStyle = color; drawing.fillRect(0, 0, 320, 240); };
            draw();
            const timer = setInterval(draw, 100);
            const audio = new AudioContext();
            await audio.resume();
            const oscillator = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination();
            oscillator.frequency.value = index === 0 ? 640 : 1280;
            gain.gain.value = 0.15;
            oscillator.connect(gain);
            gain.connect(destination);
            oscillator.start();
            const stream = canvas.captureStream(10);
            destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
            const record = { callId: call.id, stream, timer, audio, oscillator, ownId: '', peers: new Map(), signals: [], errors: [] };
            audit.push(record);
            const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/videollamada/${call.id}/?window_id=${sessionStorage.getItem('uasspain.window_session_id')}`);
            record.socket = ws;
            let processing = Promise.resolve();
            const send = (value) => { if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify(value)); };
            const peer = (id) => {
                if (record.peers.has(id))
                    return record.peers.get(id);
                const pc = new RTCPeerConnection({ iceServers: [] }), entry = { pc, candidates: [] };
                record.peers.set(id, entry);
                stream.getTracks().forEach(track => pc.addTrack(track, stream));
                pc.onicecandidate = e => { if (e.candidate)
                    send({ type: 'ice_candidate', to: id, candidate: e.candidate.toJSON() }); };
                return entry;
            };
            ws.onmessage = e => {
                processing = processing.then(async () => {
                    const message = JSON.parse(e.data);
                    record.signals.push(message);
                    if (message.type === 'welcome') {
                        record.ownId = message.peer_id;
                        return;
                    }
                    const id = message.sender_id;
                    if (!id || id === record.ownId || (message.to && message.to !== record.ownId))
                        return;
                    if (message.type === 'hangup') {
                        record.peers.get(id)?.pc.close();
                        record.peers.delete(id);
                        return;
                    }
                    const entry = peer(id), pc = entry.pc;
                    if (message.type === 'join' || message.type === 'pong') {
                        if (record.ownId < id && pc.signalingState === 'stable') {
                            await pc.setLocalDescription(await pc.createOffer());
                            send({ type: 'offer', to: id, sdp: pc.localDescription.toJSON() });
                        }
                        else if (message.type === 'join')
                            send({ type: 'pong', to: id });
                    }
                    else if ((message.type === 'offer' || message.type === 'answer') && message.sdp) {
                        await pc.setRemoteDescription(message.sdp);
                        for (const candidate of entry.candidates.splice(0))
                            await pc.addIceCandidate(candidate);
                        if (message.type === 'offer') {
                            await pc.setLocalDescription(await pc.createAnswer());
                            send({ type: 'answer', to: id, sdp: pc.localDescription.toJSON() });
                        }
                    }
                    else if (message.type === 'ice_candidate' && message.candidate) {
                        if (pc.remoteDescription)
                            await pc.addIceCandidate(message.candidate);
                        else
                            entry.candidates.push(message.candidate);
                    }
                }).catch(error => record.errors.push(error.message));
            };
        }
    }, rooms);
    for (const page of [a, b]) {
        await page.locator('aside:visible nav').getByRole('button', { name: 'Videollamada', exact: true }).click();
        await page.getByRole('button', { name: 'Unirse a la llamada', exact: true }).click();
    }
    const measurements = [];
    for (const [index, page] of [a, b].entries()) {
        const remote = page.getByRole('dialog', { name: 'Videollamada UASSPAIN' }).locator('video[aria-label="Cámara participante 1"]');
        await expect(remote).toBeVisible();
        await expect(page.getByRole('dialog', { name: 'Videollamada UASSPAIN' }).locator('video')).toHaveCount(2);
        await expect.poll(() => remote.evaluate((video, index) => { if (video.readyState < 2)
            return false; const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; const c = canvas.getContext('2d'); c.drawImage(video, 0, 0, 1, 1); const rgb = c.getImageData(0, 0, 1, 1).data; return index === 0 ? rgb[0] > 180 && rgb[2] < 60 : rgb[2] > 180 && rgb[0] < 60; }, index)).toBe(true);
        const audio = await remote.evaluate(async (video) => {
            const stream = video.srcObject, context = new AudioContext();
            await context.resume();
            const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(), mute = context.createGain();
            analyser.fftSize = 2048;
            mute.gain.value = 0;
            source.connect(analyser);
            analyser.connect(mute);
            mute.connect(context.destination);
            const values = new Float32Array(analyser.frequencyBinCount);
            let frequency = 0;
            for (let n = 0; n < 50; n++) {
                await new Promise(r => setTimeout(r, 100));
                analyser.getFloatFrequencyData(values);
                let peak = 1;
                for (let i = 2; i < values.length; i++)
                    if (values[i] > values[peak])
                        peak = i;
                if (values[peak] > -60) {
                    frequency = peak * context.sampleRate / analyser.fftSize;
                    break;
                }
            }
            source.disconnect();
            await context.close();
            return frequency;
        });
        expect(Math.abs(audio - (index === 0 ? 640 : 1280))).toBeLessThan(45);
        measurements.push({ callId: rooms[index].id, audioFrequency: audio, videoColor: index === 0 ? 'red' : 'blue' });
    }
    const transport = await teacher.evaluate(async () => Promise.all(window.privateVideoAudit.map(async (room) => {
        const stats = await Promise.all([...room.peers.values()].map(async (entry) => [...(await entry.pc.getStats()).values()]));
        return { callId: room.callId, peers: room.peers.size, errors: room.errors, dtlsConnected: stats.every(rows => rows.some((s) => s.type === 'transport' && s.dtlsState === 'connected')), audioVideoRtp: stats.every(rows => ['audio', 'video'].every(kind => rows.some((s) => s.type === 'inbound-rtp' && s.kind === kind && s.bytesReceived > 0))) };
    })));
    for (const room of transport) {
        expect(room.peers).toBe(1);
        expect(room.errors).toEqual([]);
        expect(room.dtlsConnected).toBe(true);
        expect(room.audioVideoRtp).toBe(true);
    }
    expect(errors).toEqual([]);
    return { time: new Date().toISOString(), origin: new URL(teacher.url()).origin, rooms: rooms.map(r => r.id), measurements, transport, NO_CROSS_CHANNEL_AUDIO: 'PASS', NO_CROSS_CHANNEL_VIDEO: 'PASS', errors };
}
