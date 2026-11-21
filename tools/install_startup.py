import os
import subprocess

def install():
    startup = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
    target_vbs = r"C:\Users\Prime Steel\Desktop\PrimeSteel\Start Prime Steel 24x7 (Silent Background).vbs"
    working_dir = r"C:\Users\Prime Steel\Desktop\PrimeSteel"
    lnk_path = os.path.join(startup, "Prime Steel 24x7.lnk")

    # 1. Startup folder shortcut
    ps_shortcut = f"""
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('{lnk_path}')
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"{target_vbs}"'
$s.WorkingDirectory = '{working_dir}'
$s.Description = 'Prime Steel 24x7 Server'
$s.Save()
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", ps_shortcut], check=True)
    print(f"[OK] Startup shortcut: {os.path.exists(lnk_path)}")

    # 2. Windows Task Scheduler
    ps_task = f"""
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"{target_vbs}"' -WorkingDirectory '{working_dir}'
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'PrimeSteel24x7' -Action $action -Trigger $trigger -Force
"""
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps_task], capture_output=True, text=True)
    if r.returncode == 0:
        print("[OK] Scheduled task PrimeSteel24x7 registered successfully.")
    else:
        print(f"[NOTE] Task registration output: {r.stdout or r.stderr}")

if __name__ == "__main__":
    install()
