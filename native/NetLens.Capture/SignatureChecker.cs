using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;

namespace NetLens.Capture;

/// <summary>Authenticode check, embedded signature first, then Windows catalogs. No network use.</summary>
internal static partial class SignatureChecker
{
    public const string CatalogPublisher = "Windows catalog";

    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    public static string? Publisher(string path)
    {
        try
        {
            if (VerifyFile(path)) return EmbeddedSubject(path) ?? "Signed";
            return VerifyCatalog(path) ? CatalogPublisher : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException)
        {
            return null;
        }
    }

    private static string? EmbeddedSubject(string path)
    {
#pragma warning disable SYSLIB0057
        using var cert = X509Certificate.CreateFromSignedFile(path);
#pragma warning restore SYSLIB0057
        var match = CommonName().Match(cert.Subject);
        return match.Success ? match.Groups[1].Value.Trim('"', ' ') : cert.Subject;
    }

    [GeneratedRegex(@"CN=(""[^""]+""|[^,]+)")]
    private static partial Regex CommonName();

    private static bool VerifyFile(string path)
    {
        var file = new WintrustFileInfo { Size = Marshal.SizeOf<WintrustFileInfo>(), FilePath = path };
        var filePtr = Marshal.AllocHGlobal(file.Size);
        try
        {
            Marshal.StructureToPtr(file, filePtr, false);
            return Verify(UnionChoiceFile, filePtr);
        }
        finally
        {
            Marshal.DestroyStructure<WintrustFileInfo>(filePtr);
            Marshal.FreeHGlobal(filePtr);
        }
    }

    private static bool VerifyCatalog(string path)
    {
        foreach (var algorithm in new[] { "SHA256", null })
        {
            if (!CryptCATAdminAcquireContext2(out var admin, IntPtr.Zero, algorithm, IntPtr.Zero, 0)) continue;
            try
            {
                using var stream = File.OpenRead(path);
                var size = 0;
                CryptCATAdminCalcHashFromFileHandle2(admin, stream.SafeFileHandle.DangerousGetHandle(), ref size, null, 0);
                if (size == 0) continue;
                var hash = new byte[size];
                if (!CryptCATAdminCalcHashFromFileHandle2(admin, stream.SafeFileHandle.DangerousGetHandle(), ref size, hash, 0)) continue;

                var previous = IntPtr.Zero;
                var catalog = CryptCATAdminEnumCatalogFromHash(admin, hash, size, 0, ref previous);
                if (catalog == IntPtr.Zero) continue;
                try
                {
                    var info = new CatalogInfo { Size = Marshal.SizeOf<CatalogInfo>() };
                    if (!CryptCATCatalogInfoFromContext(catalog, ref info, 0)) continue;

                    var data = new WintrustCatalogInfo
                    {
                        Size = Marshal.SizeOf<WintrustCatalogInfo>(),
                        CatalogFilePath = info.CatalogFile,
                        MemberTag = Convert.ToHexString(hash),
                        MemberFilePath = path,
                        CatAdmin = admin,
                    };
                    var ptr = Marshal.AllocHGlobal(data.Size);
                    try
                    {
                        Marshal.StructureToPtr(data, ptr, false);
                        if (Verify(UnionChoiceCatalog, ptr)) return true;
                    }
                    finally
                    {
                        Marshal.DestroyStructure<WintrustCatalogInfo>(ptr);
                        Marshal.FreeHGlobal(ptr);
                    }
                }
                finally
                {
                    CryptCATAdminReleaseCatalogContext(admin, catalog, 0);
                }
            }
            finally
            {
                CryptCATAdminReleaseContext(admin, 0);
            }
        }
        return false;
    }

    private const uint UnionChoiceFile = 1;
    private const uint UnionChoiceCatalog = 2;
    private const uint UiNone = 2;
    private const uint RevokeNone = 0;
    private const uint StateVerify = 1;
    private const uint StateClose = 2;
    private const uint CacheOnlyUrlRetrieval = 0x1000;

    private static bool Verify(uint choice, IntPtr info)
    {
        var data = new WintrustData
        {
            Size = Marshal.SizeOf<WintrustData>(),
            UiChoice = UiNone,
            RevocationChecks = RevokeNone,
            UnionChoice = choice,
            Info = info,
            StateAction = StateVerify,
            ProvFlags = CacheOnlyUrlRetrieval,
        };
        var action = GenericVerifyV2;
        var result = WinVerifyTrust(IntPtr.Zero, ref action, ref data);
        data.StateAction = StateClose;
        WinVerifyTrust(IntPtr.Zero, ref action, ref data);
        return result == 0;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WintrustFileInfo
    {
        public int Size;
        [MarshalAs(UnmanagedType.LPWStr)] public string FilePath;
        public IntPtr FileHandle;
        public IntPtr KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WintrustCatalogInfo
    {
        public int Size;
        public uint CatalogVersion;
        [MarshalAs(UnmanagedType.LPWStr)] public string CatalogFilePath;
        [MarshalAs(UnmanagedType.LPWStr)] public string MemberTag;
        [MarshalAs(UnmanagedType.LPWStr)] public string MemberFilePath;
        public IntPtr MemberFile;
        public IntPtr CalculatedFileHash;
        public int CalculatedFileHashSize;
        public IntPtr CatalogContext;
        public IntPtr CatAdmin;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WintrustData
    {
        public int Size;
        public IntPtr PolicyCallbackData;
        public IntPtr SipClientData;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public IntPtr Info;
        public uint StateAction;
        public IntPtr StateData;
        public IntPtr UrlReference;
        public uint ProvFlags;
        public uint UiContext;
        public IntPtr SignatureSettings;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CatalogInfo
    {
        public int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string CatalogFile;
    }

    [DllImport("wintrust.dll", CharSet = CharSet.Unicode)]
    private static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WintrustData data);

    [DllImport("wintrust.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CryptCATAdminAcquireContext2(out IntPtr admin, IntPtr subsystem, string? hashAlgorithm, IntPtr policy, uint flags);

    [DllImport("wintrust.dll", SetLastError = true)]
    private static extern bool CryptCATAdminReleaseContext(IntPtr admin, uint flags);

    [DllImport("wintrust.dll", SetLastError = true)]
    private static extern bool CryptCATAdminCalcHashFromFileHandle2(IntPtr admin, IntPtr file, ref int size, byte[]? hash, uint flags);

    [DllImport("wintrust.dll", SetLastError = true)]
    private static extern IntPtr CryptCATAdminEnumCatalogFromHash(IntPtr admin, byte[] hash, int size, uint flags, ref IntPtr previous);

    [DllImport("wintrust.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CryptCATCatalogInfoFromContext(IntPtr catalog, ref CatalogInfo info, uint flags);

    [DllImport("wintrust.dll", SetLastError = true)]
    private static extern bool CryptCATAdminReleaseCatalogContext(IntPtr admin, IntPtr catalog, uint flags);
}
