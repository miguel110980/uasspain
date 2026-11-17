$ErrorActionPreference='Stop'
$uasRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');scope='Local OCR comparison against existing protected accounts; no password output or changes';status='BLOCKED_OCR';accounts=@()}
$uasPlain=$null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Security
    $null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
    $null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
    $null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
    $null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
    $uasAsTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1)
    function Wait-UasOperation($operation,[Type]$resultType) { $uasTask=$uasAsTask.MakeGenericMethod($resultType).Invoke($null,@($operation)); $uasTask.GetAwaiter().GetResult() }
    $uasImage=Wait-UasOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync('C:\Users\migue\OneDrive\Desktop\WhatsApp Image 2026-11-16 at 20.12.38.jpeg')) ([Windows.Storage.StorageFile])
    $uasStream=Wait-UasOperation ($uasImage.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $uasDecoder=Wait-UasOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($uasStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $uasBitmap=Wait-UasOperation ($uasDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $uasEngine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if($null -eq $uasEngine){throw 'OCR engine unavailable'}
    $uasOcr=Wait-UasOperation ($uasEngine.RecognizeAsync($uasBitmap)) ([Windows.Media.Ocr.OcrResult])
    $uasPlain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $uasRoot '.secrets/test-accounts.dpapi')),[Text.Encoding]::UTF8.GetBytes('UASSpain|local-test-accounts|v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $uasStored=[Text.Encoding]::UTF8.GetString($uasPlain) | ConvertFrom-Json
    $uasEmails=@('instructor.prueba@example.invalid','instructor.prueba2@example.invalid','alumno.prueba@example.invalid','alumno.prueba2@example.invalid','alumno.prueba3@example.invalid','alumno.prueba4@example.invalid','alumno.prueba5@example.invalid')
    $uasText=$uasOcr.Text -replace '\s',''
    $uasReport.accounts=@(foreach($uasEmail in $uasEmails){$uasAccount=@($uasStored | Where-Object {$_.email -eq $uasEmail}); if($uasAccount.Count -ne 1){throw 'Account mapping unavailable'}; [ordered]@{email=$uasEmail;email_found_by_ocr=$uasText.Contains($uasEmail);saved_password_found_exactly_by_ocr=$uasText.Contains([string]$uasAccount[0].password)}})
    $uasReport.status='OCR_COMPARISON_ONLY_NOT_A_MANUAL_TRANSCRIPTION_PROOF'
    $uasBitmap.Dispose()
    $uasStream.Dispose()
} catch { $uasReport.error_type=$_.Exception.GetType().Name } finally {
    if($null -ne $uasPlain){[Array]::Clear($uasPlain,0,$uasPlain.Length)}
    $uasReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-17-account-image-comparison.json') -Encoding UTF8
    $uasReport | ConvertTo-Json -Depth 5 -Compress
}
