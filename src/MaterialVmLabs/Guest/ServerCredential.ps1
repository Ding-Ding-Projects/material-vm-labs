Set-StrictMode -Version 2.0

# The caller must obtain the public key directly from the hypervisor channel for
# the owned guest. The private key is ephemeral and stays inside that guest.
function Export-MvlServerCredentialKey {
    param([Parameter(Mandatory)][Security.Cryptography.RSA]$Key)
    $public = $Key.ExportParameters($false)
    if ($public.Modulus.Length -ne 256 -or [Convert]::ToBase64String($public.Exponent) -cne 'AQAB') {
        throw 'The Server credential exchange requires a 2048-bit RSA key with exponent 65537.'
    }
    return [Convert]::ToBase64String($public.Modulus)
}

function Protect-MvlServerCredential {
    param(
        [Parameter(Mandatory)][guid]$JobId,
        [Parameter(Mandatory)][string]$PublicModulus,
        [Parameter(Mandatory)][securestring]$Credential
    )
    if ($Credential.Length -lt 15 -or $Credential.Length -gt 80) {
        throw 'The DSRM password must contain 15 to 80 UTF-16 code units.'
    }
    if ($PublicModulus.Length -ne 344) { throw 'Invalid Server guest public key length.' }
    $parameters = [Security.Cryptography.RSAParameters]::new()
    $parameters.Modulus = [Convert]::FromBase64String($PublicModulus)
    if ($parameters.Modulus.Length -ne 256) { throw 'Invalid Server guest public key.' }
    $parameters.Exponent = [byte[]](1, 0, 1)

    $key = [Security.Cryptography.RSACng]::new()
    $buffer = [byte[]]::new(16 + 2 * $Credential.Length)
    $pointer = [IntPtr]::Zero
    try {
        $key.ImportParameters($parameters)
        $JobId.ToByteArray().CopyTo($buffer, 0)
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Credential)
        [Runtime.InteropServices.Marshal]::Copy($pointer, $buffer, 16, 2 * $Credential.Length)
        $packet = $key.Encrypt($buffer, [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
        return [Convert]::ToBase64String($packet)
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer) }
        [Array]::Clear($buffer, 0, $buffer.Length)
        $key.Dispose()
    }
}

function Unprotect-MvlServerCredential {
    param(
        [Parameter(Mandatory)][guid]$JobId,
        [Parameter(Mandatory)][Security.Cryptography.RSA]$Key,
        [Parameter(Mandatory)][string]$Packet
    )
    if ($Packet.Length -ne 344) { throw 'Invalid Server credential packet length.' }
    $ciphertext = [Convert]::FromBase64String($Packet)
    if ($ciphertext.Length -ne 256) { throw 'Invalid Server credential packet.' }
    $buffer = $Key.Decrypt($ciphertext, [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
    $credential = [Security.SecureString]::new()
    try {
        if ($buffer.Length -lt 46 -or $buffer.Length -gt 176 -or $buffer.Length % 2) {
            throw 'The Server credential packet contains an invalid password length.'
        }
        $receivedJob = [guid]::new([byte[]]($buffer[0..15]))
        if ($receivedJob -ne $JobId) { throw 'The Server credential packet belongs to another provisioning job.' }
        for ($offset = 16; $offset -lt $buffer.Length; $offset += 2) {
            $character = [char][BitConverter]::ToUInt16($buffer, $offset)
            if ($character -eq [char]0) { throw 'The Server credential contains an unsupported null character.' }
            $credential.AppendChar($character)
        }
        $credential.MakeReadOnly()
        return $credential
    } catch {
        $credential.Dispose()
        throw
    } finally { [Array]::Clear($buffer, 0, $buffer.Length) }
}
