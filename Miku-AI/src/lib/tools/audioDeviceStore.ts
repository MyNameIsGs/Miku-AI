// Tarea 6.4 (extensión): mismo patrón que appLauncherStore.ts -- las
// tools son módulos planos, no componentes de React, así que useAudioDevices
// escribe acá cada vez que refresca la lista de dispositivos de salida.
export type AudioOutputDevice = { name: string; id: string };

let devices: AudioOutputDevice[] = [];

export function setAudioDevices(next: AudioOutputDevice[]) {
  devices = next;
}

export function getAudioDevices(): AudioOutputDevice[] {
  return devices;
}
