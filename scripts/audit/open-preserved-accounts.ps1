# Local interactive reader for the existing DPAPI store. No console credential output.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
$uasPlain=$null
$uasCopied=$null
$uasAccounts=$null
function Set-UasReaderStage([string]$stage){[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');pid=$PID;stage=$stage} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $PSScriptRoot '../../.run/uasspain/credential-reader-state.json') -Encoding UTF8}
Set-UasReaderStage 'STARTED'
try {
    $uasRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
    $uasPlain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $uasRoot '.secrets/test-accounts.dpapi')),[Text.Encoding]::UTF8.GetBytes('UASSpain|local-test-accounts|v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $uasStored=[Text.Encoding]::UTF8.GetString($uasPlain) | ConvertFrom-Json
    $uasEmails=@('instructor.prueba@example.invalid','instructor.prueba2@example.invalid','alumno.prueba@example.invalid','alumno.prueba2@example.invalid','alumno.prueba3@example.invalid','alumno.prueba4@example.invalid','alumno.prueba5@example.invalid')
    $uasAccounts=@(foreach($uasEmail in $uasEmails){$uasMatch=@($uasStored | Where-Object {$_.email -eq $uasEmail});if($uasMatch.Count -ne 1){throw 'Account mapping unavailable'};$uasMatch[0]})
    Set-UasReaderStage 'STORE_LOADED_IN_MEMORY'
    $uasForm=New-Object Windows.Forms.Form
    $uasForm.Text='uasspain - Cuentas conservadas (solo lectura)'
    $uasForm.ClientSize=New-Object Drawing.Size(650,255)
    $uasForm.StartPosition='CenterScreen'
    $uasForm.FormBorderStyle='FixedDialog'
    $uasForm.MaximizeBox=$false
    $uasForm.MinimizeBox=$false
    $uasForm.Font=New-Object Drawing.Font('Segoe UI',10)
    $uasInfo=New-Object Windows.Forms.Label
    $uasInfo.Text='Copia los datos originales; evita transcribir los caracteres de la fotografia.'
    $uasInfo.SetBounds(18,15,615,30)
    $uasSelect=New-Object Windows.Forms.ComboBox
    $uasSelect.DropDownStyle='DropDownList'
    $uasSelect.SetBounds(18,52,610,30)
    foreach($uasAccount in $uasAccounts){[void]$uasSelect.Items.Add($uasAccount.email)}
    $uasEmailBox=New-Object Windows.Forms.TextBox
    $uasEmailBox.ReadOnly=$true
    $uasEmailBox.SetBounds(18,98,430,28)
    $uasPasswordBox=New-Object Windows.Forms.TextBox
    $uasPasswordBox.ReadOnly=$true
    $uasPasswordBox.UseSystemPasswordChar=$true
    $uasPasswordBox.SetBounds(18,140,430,28)
    $uasCopyEmail=New-Object Windows.Forms.Button
    $uasCopyEmail.Text='Copiar correo'
    $uasCopyEmail.SetBounds(465,96,163,32)
    $uasCopyPassword=New-Object Windows.Forms.Button
    $uasCopyPassword.Text='Copiar contrasena'
    $uasCopyPassword.SetBounds(465,138,163,32)
    $uasStatus=New-Object Windows.Forms.Label
    $uasStatus.Text='No se ha cambiado ninguna cuenta ni contrasena.'
    $uasStatus.SetBounds(18,195,610,45)
    $uasSelect.Add_SelectedIndexChanged({$uasSelected=$uasAccounts[$uasSelect.SelectedIndex];$uasEmailBox.Text=$uasSelected.email;$uasPasswordBox.Text=$uasSelected.password})
    $uasCopyEmail.Add_Click({[Windows.Forms.Clipboard]::SetText($uasEmailBox.Text);$uasStatus.Text='Correo copiado. Pegalo en el formulario de acceso.'})
    $uasCopyPassword.Add_Click({[Windows.Forms.Clipboard]::SetText($uasPasswordBox.Text);$script:uasCopied=$uasPasswordBox.Text;$uasStatus.Text='Contrasena copiada. Pegala en la web; no la envies al chat.'})
    $uasForm.Controls.AddRange(@($uasInfo,$uasSelect,$uasEmailBox,$uasPasswordBox,$uasCopyEmail,$uasCopyPassword,$uasStatus))
    $uasSelect.SelectedIndex=0
    $uasForm.Add_Shown({Set-UasReaderStage 'SHOWN';$uasForm.Activate()})
    Set-UasReaderStage 'WINDOW_PREPARED'
    [void]$uasForm.ShowDialog()
} catch {
    Set-UasReaderStage ('ERROR_'+$_.Exception.GetType().Name)
    [void][Windows.Forms.MessageBox]::Show('No se ha podido abrir el almacen protegido. No se ha cambiado ninguna cuenta.','uasspain')
} finally {
    if($uasCopied -and [Windows.Forms.Clipboard]::ContainsText() -and [Windows.Forms.Clipboard]::GetText() -ceq $uasCopied){[Windows.Forms.Clipboard]::Clear()}
    if($null -ne $uasPlain){[Array]::Clear($uasPlain,0,$uasPlain.Length)}
    if($null -ne $uasPasswordBox){$uasPasswordBox.Clear()}
    $uasAccounts=$null
    $uasStored=$null
    $uasCopied=$null
    if($null -ne $uasForm){$uasForm.Dispose()}
}
