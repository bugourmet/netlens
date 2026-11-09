using System.Security.AccessControl;
using System.Security.Principal;

namespace NetLens.Capture;

/// <summary>
/// Where the helper keeps its database. An elevated process must not write into a folder
/// that unelevated code can replace with a link to somewhere protected, so the elevated
/// helper uses an admin-only folder under ProgramData and checks it before every start.
/// </summary>
internal static class DataDirectory
{
    private static readonly SecurityIdentifier Administrators = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier LocalSystem = new(WellKnownSidType.LocalSystemSid, null);

    private const FileSystemRights WriteRights =
        FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.WriteAttributes |
        FileSystemRights.WriteExtendedAttributes | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
        FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;

    /// <summary>Database path, or null to keep memory only because the folder can't be trusted.</summary>
    public static string? DatabasePath(bool elevated, Action<string> log)
    {
        if (!elevated)
        {
            var user = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NetLens");
            Directory.CreateDirectory(user);
            return Path.Combine(user, "netlens.db");
        }

        var dir = new DirectoryInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NetLens"));
        if (!dir.Exists)
        {
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
            security.SetOwner(Administrators);
            foreach (var sid in new[] { Administrators, LocalSystem })
                security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            dir.Create(security); // no-op if someone created it in between; the check below catches that
            dir.Refresh();
        }

        if (!IsAdminOnly(dir, out var reason))
        {
            log($"not using {dir.FullName}: {reason}. First-seen data won't be saved this run.");
            return null;
        }
        return Path.Combine(dir.FullName, "netlens.db");
    }

    private static bool IsAdminOnly(DirectoryInfo dir, out string reason)
    {
        if (dir.Attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            reason = "it is a link";
            return false;
        }
        var acl = dir.GetAccessControl();
        if (acl.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !IsTrusted(owner))
        {
            reason = "it isn't owned by Administrators";
            return false;
        }
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & WriteRights) != 0 &&
                rule.IdentityReference is SecurityIdentifier sid && !IsTrusted(sid))
            {
                reason = $"{sid} can write to it";
                return false;
            }
        }
        reason = "";
        return true;
    }

    private static bool IsTrusted(SecurityIdentifier sid) => sid == Administrators || sid == LocalSystem;
}
