import os
import subprocess

def install():
    startup = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
    target_vbs = r"C:\Users\Prime Steel\Desktop\PrimeSteel\Start Excel Sync Agent (Silent Background).vbs"
    working_dir = r"C:\Users\Prime Steel\Desktop\PrimeSteel"
    lnk_path = os.path.join(startup, "Prime Steel Sync Agent.lnk")

    ps_shortcut = f"""
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('{lnk_path}')
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"{target_vbs}"'
$s.WorkingDirectory = '{working_dir}'
$s.Description = 'Prime Steel Excel Sync Agent'
$s.Save()
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", ps_shortcut], check=True)
    print(f"[OK] Startup shortcut: {os.path.exists(lnk_path)}")

if __name__ == "__main__":
    install()
