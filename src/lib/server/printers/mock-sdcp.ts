/**
 * A fake Elegoo SDCP printer for tests and e2e (not used by the app): answers Cmd 0 / Cmd 1
 * and pushes the status whenever `set()` changes it.
 */
import { MiniWsServer, sendJson } from './mini-ws';

const MAINBOARD = 'ABCDEF0123456789ABCDEF0123456789';

export interface MockStatus {
	printStatus: number; // PrintInfo.Status: 0 idle, 13 printing, 6 paused, 9 complete, 8 stopped
	machineStatus: number[];
	file: string;
	progress: number;
	layer: number;
	totalLayer: number;
	ticks: number; // seconds
	totalTicks: number;
	nozzle: number;
	bed: number;
}

export class MockSdcp extends MiniWsServer {
	received: { cmd: number }[] = [];
	status: MockStatus = {
		printStatus: 0,
		machineStatus: [0],
		file: '',
		progress: 0,
		layer: 0,
		totalLayer: 0,
		ticks: 0,
		totalTicks: 0,
		nozzle: 25,
		bed: 24
	};

	constructor() {
		super();
		this.onMessage = (socket, text) => {
			let msg: { Data?: { Cmd?: number } };
			try {
				msg = JSON.parse(text);
			} catch {
				return;
			}
			const cmd = msg.Data?.Cmd;
			if (typeof cmd !== 'number') return;
			this.received.push({ cmd });
			if (cmd === 0) sendJson(socket, this.statusMessage());
			if (cmd === 1) sendJson(socket, this.attributesMessage());
		};
	}

	set(patch: Partial<MockStatus>) {
		Object.assign(this.status, patch);
		this.broadcast(this.statusMessage());
	}

	statusMessage() {
		const s = this.status;
		return {
			Id: 'x',
			Topic: `sdcp/status/${MAINBOARD}`,
			MainboardID: MAINBOARD,
			Status: {
				CurrentStatus: s.machineStatus,
				TempOfNozzle: s.nozzle,
				TempTargetNozzle: 0,
				TempOfHotbed: s.bed,
				TempTargetHotbed: 0,
				TempOfBox: 28,
				CurrenCoord: '0.00,0.00,0.00',
				PrintInfo: {
					Status: s.printStatus,
					CurrentLayer: s.layer,
					TotalLayer: s.totalLayer,
					CurrentTicks: s.ticks,
					TotalTicks: s.totalTicks,
					Filename: s.file,
					ErrorNumber: 0,
					TaskId: 'task-1',
					PrintSpeedPct: 100,
					Progress: s.progress
				}
			}
		};
	}

	attributesMessage() {
		return {
			Topic: `sdcp/attributes/${MAINBOARD}`,
			Attributes: {
				Name: 'Centauri Carbon',
				MachineName: 'Centauri Carbon',
				BrandName: 'ELEGOO',
				MainboardID: MAINBOARD,
				FirmwareVersion: 'V1.1.46',
				ProtocolVersion: 'V3.0.0'
			}
		};
	}

	/** Stand-in for a printer status object, reaching a full lifecycle from `set` calls. */
	printing(file: string, progress: number, extra: Partial<MockStatus> = {}) {
		this.set({
			printStatus: 13,
			machineStatus: [1],
			file,
			progress,
			layer: Math.round(progress * 4),
			totalLayer: 400,
			ticks: progress * 60,
			totalTicks: 6000,
			...extra
		});
	}
}
