"""Generate a properly-sized AMARA desktop icon and embed it into Windows executables.

Isolates the 3D ribbon emblem, crops out unnecessary margins and the wordmark
text that causes desktop icons to appear squished/tiny, and scales it to match
the visual weight of AMARA KH PRO and standard desktop applications.
"""
from pathlib import Path
import ctypes as C
from ctypes import wintypes as W
import json
import shutil
import struct
import subprocess
import time
import argparse
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
LOGO_PATH = ROOT / 'assets/AMARA LOGO DL.png'
ICON_PATH = ROOT / 'Hongguo English/amara.ico'
EXE_PATH = ROOT / 'Hongguo English/AMARA Downloader.exe'

ICON_SIZES = [
    (256, 256),
    (128, 128),
    (96, 96),
    (64, 64),
    (48, 48),
    (40, 40),
    (32, 32),
    (24, 24),
    (20, 20),
    (16, 16),
]


def generate_icon(logo_path=LOGO_PATH, icon_path=ICON_PATH):
    """Crop the emblem, center it on a 256x256 canvas with proper scaling, and save multi-resolution ICO."""
    if not logo_path.is_file():
        raise FileNotFoundError(f'Logo artwork not found: {logo_path}')

    im = Image.open(logo_path).convert('RGBA')
    arr = np.array(im)

    # 1. Clear text below emblem (the wordmark starts below y=715)
    # Slicing off the text prevents the emblem from squishing down to fit a wide logo
    emblem_arr = arr[:715, :, :]
    alpha = emblem_arr[:, :, 3]

    # 2. Extract bounding box with alpha > 15 to eliminate compression halos/glow
    mask = alpha > 15
    if not np.any(mask):
        raise ValueError('No visible emblem pixels found in artwork')

    ymin, ymax = np.where(np.any(mask, axis=1))[0][[0, -1]]
    xmin, xmax = np.where(np.any(mask, axis=0))[0][[0, -1]]

    cropped = Image.fromarray(emblem_arr[ymin:ymax + 1, xmin:xmax + 1])
    orig_w, orig_h = cropped.size
    print(f'Emblem isolated: {orig_w}x{orig_h} (aspect ratio: {orig_w / orig_h:.3f})')

    # 3. Fit into 256x256 canvas
    # Target width 248 gives height ~183, leaving 4px horizontal and ~36px vertical margin.
    # This precisely matches AMARA KH PRO (250x173) and Video Cut Pro (234x170).
    target_w = 248
    target_h = int(round(orig_h * (target_w / orig_w)))
    if target_h > 250:
        target_h = 250
        target_w = int(round(orig_w * (250 / orig_h)))

    print(f'Scaling emblem to {target_w}x{target_h} (centered on 256x256 canvas)...')
    resized = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas_256 = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    paste_x = (256 - target_w) // 2
    paste_y = (256 - target_h) // 2
    canvas_256.paste(resized, (paste_x, paste_y), resized)

    icon_path.parent.mkdir(parents=True, exist_ok=True)
    canvas_256.save(icon_path, format='ICO', sizes=ICON_SIZES)
    print(f'Saved multi-resolution icon to {icon_path}')

    # Also save a high-res PNG for preview and reference
    png_path = ROOT / 'assets/amara-icon-256.png'
    canvas_256.save(png_path, 'PNG')

    return canvas_256


def embed_icon_into_exe(target_exe, icon_path=ICON_PATH):
    """Embed the multi-frame icon into a Windows PE executable's resources."""
    if not target_exe.is_file():
        print(f'Target executable not found (skipped): {target_exe}')
        return False

    k = C.WinDLL('kernel32', use_last_error=True)
    k.LoadLibraryExW.argtypes = [W.LPCWSTR, W.HANDLE, W.DWORD]
    k.LoadLibraryExW.restype = W.HMODULE
    k.FreeLibrary.argtypes = [W.HMODULE]
    callback_type = C.WINFUNCTYPE(W.BOOL, W.HMODULE, C.c_void_p, C.c_void_p, C.c_ssize_t)
    k.EnumResourceNamesW.argtypes = [W.HMODULE, C.c_void_p, callback_type, C.c_ssize_t]

    groups = []

    @callback_type
    def collect(module, kind, name, param):
        groups.append(name if name <= 65535 else C.wstring_at(name))
        return True

    module = k.LoadLibraryExW(str(target_exe), None, 2)
    if not module:
        raise C.WinError(C.get_last_error())
    k.EnumResourceNamesW(module, 14, collect, 0)
    k.FreeLibrary(module)
    if not groups:
        groups = [1]

    backup = ROOT / 'backups/AMARA.before-icon.exe'
    backup.parent.mkdir(parents=True, exist_ok=True)
    if target_exe == EXE_PATH and not backup.exists():
        shutil.copy2(target_exe, backup)

    k.BeginUpdateResourceW.argtypes = [W.LPCWSTR, W.BOOL]
    k.BeginUpdateResourceW.restype = W.HANDLE
    k.UpdateResourceW.argtypes = [W.HANDLE, C.c_void_p, C.c_void_p, W.WORD, C.c_void_p, W.DWORD]
    k.EndUpdateResourceW.argtypes = [W.HANDLE, W.BOOL]

    handle = k.BeginUpdateResourceW(str(target_exe), False)
    if not handle:
        raise C.WinError(C.get_last_error())

    def update(kind, name, data):
        name_ptr = C.c_void_p(name) if isinstance(name, int) else C.cast(C.c_wchar_p(name), C.c_void_p)
        buf = C.create_string_buffer(data)
        if not k.UpdateResourceW(handle, kind, name_ptr, 1033, buf, len(data)):
            raise C.WinError(C.get_last_error())

    try:
        raw = icon_path.read_bytes()
        count = struct.unpack_from('<H', raw, 4)[0]
        group = raw[:6]
        for i in range(count):
            entry = raw[6 + 16 * i:22 + 16 * i]
            size, offset = struct.unpack_from('<II', entry, 8)
            update(3, i + 1, raw[offset:offset + size])
            group += entry[:12] + struct.pack('<H', i + 1)
        for name in groups:
            update(14, name, group)
    except BaseException:
        k.EndUpdateResourceW(handle, True)
        raise

    committed = False
    for attempt in range(5):
        if k.EndUpdateResourceW(handle, False):
            committed = True
            break
        time.sleep(0.5)
    if not committed:
        raise C.WinError(C.get_last_error())

    print(f'Embedded icon into {target_exe.name}: {count} sizes; resource groups {groups}')
    return True


def update_desktop_shortcuts(icon_path=ICON_PATH):
    """Update Desktop shortcuts and notify Windows Shell to refresh icon cache."""
    user_desktop = Path.home() / 'Desktop'
    common_desktop = Path('C:/Users/DARA/Desktop')

    shortcut_targets = []
    for d in {user_desktop, common_desktop}:
        if d.is_dir():
            for p in d.glob('*.lnk'):
                if 'AMARA Downloader' in p.name:
                    shortcut_targets.append(p)

    if shortcut_targets:
        vbs_lines = ['Set w = CreateObject("WScript.Shell")']
        for sc in shortcut_targets:
            vbs_lines.append(f'Set s = w.CreateShortcut("{str(sc)}")')
            vbs_lines.append(f's.IconLocation = "{str(icon_path)},0"')
            vbs_lines.append('s.Save')

        vbs_script = ROOT / 'artifacts/update_shortcuts.vbs'
        vbs_script.parent.mkdir(parents=True, exist_ok=True)
        vbs_script.write_text('\r\n'.join(vbs_lines), encoding='utf-8')
        try:
            subprocess.run(['cscript', '//nologo', str(vbs_script)], check=True)
            print(f'Updated {len(shortcut_targets)} desktop shortcut(s) with new icon location.')
        except Exception as e:
            print(f'Notice: Desktop shortcut update skipped: {e}')
        finally:
            if vbs_script.exists():
                vbs_script.unlink()

    # Flush Windows Explorer icon cache so changes appear immediately
    try:
        C.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)  # SHCNE_ASSOCCHANGED
        print('Notified Windows Shell to refresh icon cache.')
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, help='Update only a staged runtime; leave shortcuts and the running app alone')
    args = parser.parse_args()
    print('=== AMARA Downloader Icon Builder ===')
    if args.runtime:
        runtime = args.runtime.resolve()
        generate_icon(icon_path=runtime / 'amara.ico')
        embed_icon_into_exe(runtime / 'AMARA Downloader.exe', runtime / 'amara.ico')
        return
    generate_icon()

    # Embed into main runtime executable
    if EXE_PATH.is_file():
        embed_icon_into_exe(EXE_PATH)

    # Also update portable build folder if present
    pkg_file = ROOT / 'source/package.json'
    if pkg_file.is_file():
        version = json.loads(pkg_file.read_text(encoding='utf-8')).get('version', '')
        portable_dir = ROOT / f'release/AMARA-Downloader-v{version}-Windows-Portable'
        if portable_dir.is_dir():
            shutil.copy2(ICON_PATH, portable_dir / 'amara.ico')
            portable_exe = portable_dir / 'AMARA Downloader.exe'
            if portable_exe.is_file():
                embed_icon_into_exe(portable_exe)

    # Update shortcuts and refresh shell cache
    update_desktop_shortcuts(ICON_PATH)
    print('=== AMARA Icon Update Complete ===')


if __name__ == '__main__':
    main()
