[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param([Parameter(Mandatory)][ValidateRange(1,65535)][int]$Port,[Parameter(Mandatory)][string]$PeerAddress,[switch]$Apply)
$ErrorActionPreference='Stop'
$parsed=$null
if(-not[Net.IPAddress]::TryParse($PeerAddress,[ref]$parsed)){throw 'Use a specific peer IP address, not a broad subnet.'}
$name='UASSpain-WireGuard-'+$Port+'-'+$parsed.ToString().Replace(':','_')
if(-not $Apply){Write-Output "NOT_APPLIED: allow inbound UDP $Port only from $PeerAddress; no default-policy changes.";exit 0}
$existing=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
if($existing){
    $ports=$existing|Get-NetFirewallPortFilter
    $addresses=$existing|Get-NetFirewallAddressFilter
    if($ports.Protocol -ne 'UDP' -or $ports.LocalPort -ne $Port -or $addresses.RemoteAddress -ne $PeerAddress -or $existing.Action -ne 'Allow'){throw 'Existing rule differs; no overwrite.'}
    Write-Output 'RULE_ALREADY_PRESENT';exit 0
}
if($PSCmdlet.ShouldProcess($name,"Allow inbound UDP $Port only from $PeerAddress")){
    New-NetFirewallRule -Name $name -DisplayName $name -Direction Inbound -Protocol UDP -LocalPort $Port -RemoteAddress $PeerAddress -Action Allow | Out-Null
    Write-Output 'RULE_ADDED'
}
