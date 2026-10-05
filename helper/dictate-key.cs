// dictate-key: writes ONE fixed key press into the console of the parent process
// (Claude Code), so the mod can trigger Claude Code's own voice keybinding.
// Accepts only "f11" (bound to voice:pushToTalk) or "escape"; never the user's Dictate
// shortcut, so a toggle cannot trigger itself.
using System;
using System.Runtime.InteropServices;

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

    const int AttachParentProcess = -1;
    const uint GenericReadWrite = 0xC0000000;
    const uint ShareReadWrite = 3;
    const uint OpenExisting = 3;

    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll")] static extern bool AttachConsole(int processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool WriteConsoleInputW(IntPtr input, KeyRecord[] records, uint count, out uint written);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static int Main(string[] args)
    {
        ushort vk;
        char ch;
        switch (args.Length == 1 ? args[0] : "")
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
}
