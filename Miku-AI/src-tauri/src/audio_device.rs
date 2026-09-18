use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::process::Command;
use windows::core::{Result as WinResult, GUID, HSTRING, PCWSTR};
use windows::Win32::Media::Audio::{
    eConsole, eCommunications, eMultimedia, eRender, ERole, IMMDeviceEnumerator, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;

// IPolicyConfig: interfaz COM NO documentada oficialmente por Microsoft --
// no existe en los metadatos de windows-rs (por eso no está en el crate
// `windows`), hay que declararla a mano. Es la misma que usan herramientas
// reales como EarTrumpet y el módulo de PowerShell AudioDeviceCmdlets para
// cambiar el dispositivo de salida predeterminado; no hay ninguna API
// pública de Microsoft para esto. CLSID, IID y el orden exacto de los 12
// métodos del vtable verificados empíricamente en esta máquina (Windows
// 11) con una implementación C# independiente: hice un cambio real del
// dispositivo predeterminado, confirmé por fuera que cambió de verdad, y
// lo restauré. Los primeros 9 métodos son stubs solo para que el vtable
// quede alineado -- nunca se llaman.
#[repr(C)]
pub struct IPolicyConfig_Vtbl {
    pub base__: windows_core::IUnknown_Vtbl,
    pub get_mix_format: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        *mut *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub get_device_format: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        windows_core::BOOL,
        *mut *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub reset_device_format:
        unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR) -> windows_core::HRESULT,
    pub set_device_format: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        *mut core::ffi::c_void,
        *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub get_processing_period: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        windows_core::BOOL,
        *mut i64,
        *mut i64,
    ) -> windows_core::HRESULT,
    pub set_processing_period: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        *const i64,
    ) -> windows_core::HRESULT,
    pub get_share_mode: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub set_share_mode: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        *const core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub get_property_value: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        windows_core::BOOL,
        *const core::ffi::c_void,
        *mut core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub set_property_value: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        windows_core::BOOL,
        *const core::ffi::c_void,
        *const core::ffi::c_void,
    ) -> windows_core::HRESULT,
    pub set_default_endpoint:
        unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, i32) -> windows_core::HRESULT,
    pub set_endpoint_visibility: unsafe extern "system" fn(
        *mut core::ffi::c_void,
        PCWSTR,
        windows_core::BOOL,
    ) -> windows_core::HRESULT,
}

windows_core::imp::define_interface!(
    IPolicyConfig,
    IPolicyConfig_Vtbl,
    0xf8679f50_850a_41cf_9c72_430f290290c8
);
windows_core::imp::interface_hierarchy!(IPolicyConfig, windows_core::IUnknown);

impl IPolicyConfig {
    unsafe fn set_default_endpoint_role(&self, device_id: &HSTRING, role: ERole) -> WinResult<()> {
        (windows_core::Interface::vtable(self).set_default_endpoint)(
            windows_core::Interface::as_raw(self),
            PCWSTR::from_raw(device_id.as_ptr()),
            role.0,
        )
        .ok()
    }
}

const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

// PKEY_DeviceInterface_FriendlyName -- se lee del registro en vez de vía
// IPropertyStore/PROPVARIANT (API pública pero mucho más código inseguro
// para lo mismo). Mismo patrón que find_steam_install_path en
// app_launcher.rs: apoyarse en `reg query` en vez de reimplementar acceso
// al registro en Rust.
fn get_friendly_name(device_guid_braced: &str) -> Option<String> {
    let key = format!(
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{}\Properties",
        device_guid_braced
    );
    let output = Command::new("reg")
        .args(["query", &key, "/v", "{a45c254e-df1c-4efd-8020-67d146a850e0},2"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if let Some(idx) = line.find("REG_SZ") {
            let name = line[idx + "REG_SZ".len()..].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub name: String,
    pub id: String,
}

#[tauri::command]
pub fn list_audio_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Error accediendo a los dispositivos de audio: {e}"))?;
        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Error enumerando dispositivos de audio: {e}"))?;
        let count = collection
            .GetCount()
            .map_err(|e| format!("Error contando dispositivos de audio: {e}"))?;

        let mut devices = Vec::new();
        for i in 0..count {
            let Ok(device) = collection.Item(i) else {
                continue;
            };
            let Ok(id_pwstr) = device.GetId() else {
                continue;
            };
            let id = id_pwstr.to_string().unwrap_or_default();
            CoTaskMemFree(Some(id_pwstr.0 as *const _));
            if id.is_empty() {
                continue;
            }

            // El id viene como "{0.0.0.00000000}.{<guid>}" -- el nombre
            // amigable vive en el registro bajo ese <guid> suelto.
            let guid = id.rsplit('{').next().unwrap_or("").trim_end_matches('}');
            let name =
                get_friendly_name(&format!("{{{}}}", guid)).unwrap_or_else(|| id.clone());

            devices.push(AudioOutputDevice { name, id });
        }

        Ok(devices)
    }
}

#[tauri::command]
pub fn set_default_audio_output(device_id: String) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let policy: IPolicyConfig = CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL)
            .map_err(|e| format!("Error accediendo al control de dispositivos de audio: {e}"))?;

        let id = HSTRING::from(device_id.as_str());
        for role in [eConsole, eMultimedia, eCommunications] {
            policy
                .set_default_endpoint_role(&id, role)
                .map_err(|e| format!("Error cambiando el dispositivo de salida: {e}"))?;
        }
    }
    Ok(())
}
