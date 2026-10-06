// dictate-key: the DictateCLI helper. Two jobs, each a fixed argument:
//   "f11" / "escape": write ONE key press into the console of the parent process
//     (Claude Code): F11 is bound to voice:pushToTalk, Esc is Claude Code's voice cancel.
//     Never the user's DictateCLI shortcut, so a toggle cannot trigger itself.
//   "mic": read-only; is the parent's executable using the microphone right now?
//     Windows records this per app (the tray mic icon): LastUsedTimeStop is 0 while in
//     use. Exit 10 = in use, 11 = not in use, 12 = unknown.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

static class DictateKey
{
    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    struct KeyRecord
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public int KeyDown;
        [FieldOffset(8)] public ushort RepeatCount;
        [FieldOffset(10)] public ushort VirtualKeyCode;
        [FieldOffset(12)] public ushort VirtualScanCode;
        [FieldOffset(14)] public char UnicodeChar;
        [FieldOffset(16)] public uint ControlKeyState;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessBasicInformation
    {
        public IntPtr ExitStatus;
        public IntPtr PebBaseAddress;
        public IntPtr AffinityMask;
        public IntPtr BasePriority;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    const int AttachParentProcess = -1;
    const uint GenericReadWrite = 0xC0000000;
    const uint ShareReadWrite = 3;
    const uint OpenExisting = 3;
    const string MicStore = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged\";

    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll")] static extern bool AttachConsole(int processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool WriteConsoleInputW(IntPtr input, KeyRecord[] records, uint count, out uint written);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref ProcessBasicInformation info, int size, out int returned);

    static int Main(string[] args)
    {
        string arg = args.Length == 1 ? args[0] : "";
        if (arg == "mic") return MicInUse();

        ushort vk;
        char ch;
        switch (arg)
        {
            case "f11": vk = 0x7A; ch = '\0'; break;
            case "escape": vk = 0x1B; ch = (char)27; break;
            default: return 64;
        }

        FreeConsole();
        if (!AttachConsole(AttachParentProcess)) return 2;
        IntPtr input = CreateFileW("CONIN$", GenericReadWrite, ShareReadWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
        if (input == new IntPtr(-1)) return 3;

        var records = new KeyRecord[2];
        for (int i = 0; i < 2; i++)
        {
            records[i].EventType = 1; // KEY_EVENT
            records[i].KeyDown = i == 0 ? 1 : 0;
            records[i].RepeatCount = 1;
            records[i].VirtualKeyCode = vk;
            records[i].UnicodeChar = ch;
        }
        uint written;
        bool ok = WriteConsoleInputW(input, records, 2, out written);
        CloseHandle(input);
        return ok && written == 2 ? 0 : 4;
    }

    static int MicInUse()
    {
        try
        {
            var info = new ProcessBasicInformation();
            int returned;
            if (NtQueryInformationProcess(Process.GetCurrentProcess().Handle, 0, ref info, Marshal.SizeOf(info), out returned) != 0) return 12;
            string exe = Process.GetProcessById(info.InheritedFromUniqueProcessId.ToInt32()).MainModule.FileName;
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(MicStore + exe.Replace('\\', '#')))
            {
                object stop = key == null ? null : key.GetValue("LastUsedTimeStop");
                if (stop == null) return 12;
                return Convert.ToInt64(stop) == 0 ? 10 : 11;
            }
        }
        catch
        {
            return 12;
        }
    }
}
