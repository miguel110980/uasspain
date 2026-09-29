param(
    [int]$Concurrency = 20
)

$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp -ReferencedAssemblies 'System.Net.Http.dll' -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

public sealed class LoadResult {
    public double Milliseconds { get; set; }
    public int Status { get; set; }
    public string Error { get; set; }
}

public static class UASSpainLoadSmoke {
    private static async Task<LoadResult> One(HttpClient client, string url, SemaphoreSlim gate, int paceMilliseconds) {
        await gate.WaitAsync();
        var timer = Stopwatch.StartNew();
        LoadResult result;
        try {
            using (var response = await client.GetAsync(url)) {
                await response.Content.ReadAsByteArrayAsync();
                result = new LoadResult { Milliseconds = timer.Elapsed.TotalMilliseconds, Status = (int)response.StatusCode };
            }
        } catch (Exception error) {
            result = new LoadResult { Milliseconds = timer.Elapsed.TotalMilliseconds, Status = 0, Error = error.GetType().Name + ": " + error.Message };
        }
        if (paceMilliseconds > 0) await Task.Delay(paceMilliseconds);
        gate.Release();
        return result;
    }

    public static LoadResult[] Run(string url, int count, int concurrency, int paceMilliseconds) {
        var handler = new HttpClientHandler {
            ServerCertificateCustomValidationCallback = (message, certificate, chain, errors) => true,
            MaxConnectionsPerServer = concurrency,
            UseProxy = false
        };
        using (handler)
        using (var client = new HttpClient(handler))
        using (var gate = new SemaphoreSlim(concurrency, concurrency)) {
            client.Timeout = TimeSpan.FromSeconds(10);
            var tasks = Enumerable.Range(0, count).Select(_ => One(client, url, gate, paceMilliseconds)).ToArray();
            return Task.WhenAll(tasks).GetAwaiter().GetResult();
        }
    }
}
'@
if (-not ('UASSpainLoadSmoke' -as [type])) { throw 'No se pudo compilar el runner de carga.' }

function Get-Percentile([double[]]$Values, [double]$Percentile) {
    $ordered = $Values | Sort-Object
    $index = [Math]::Max(0, [Math]::Min($ordered.Count - 1, [Math]::Ceiling($ordered.Count * $Percentile) - 1))
    return $ordered[$index]
}

$targets = @(
    @{ Label = 'ready_accepted_load'; Url = 'https://127.0.0.1/api/health/ready/'; Count = 150; Concurrency = 5; PaceMs = 250; ExpectRateLimit = $false },
    @{ Label = 'frontend'; Url = 'https://127.0.0.1/'; Count = 500; Concurrency = 20; PaceMs = 0; ExpectRateLimit = $false },
    @{ Label = 'api_rate_limit_protection'; Url = 'https://127.0.0.1/api/health/ready/'; Count = 200; Concurrency = 20; PaceMs = 0; ExpectRateLimit = $true }
)
$report = @()
$failed = $false

foreach ($target in $targets) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $results = [UASSpainLoadSmoke]::Run($target.Url, $target.Count, $target.Concurrency, $target.PaceMs)
    $timer.Stop()
    $latencies = [double[]]($results | ForEach-Object { $_.Milliseconds })
    $successes = @($results | Where-Object { $_.Status -ge 200 -and $_.Status -lt 400 }).Count
    $errors = $target.Count - $successes
    $rateLimited = @($results | Where-Object { $_.Status -eq 429 }).Count
    if ($target.ExpectRateLimit) {
        $failed = $failed -or ($rateLimited -eq 0)
    } else {
        $failed = $failed -or ($errors -gt 0)
    }
    $statuses = $results | Group-Object Status | ForEach-Object { @{ status = $_.Name; count = $_.Count } }
    $firstError = ($results | Where-Object Error | Select-Object -First 1).Error
    $report += [ordered]@{
        label = $target.Label
        requests = $target.Count
        concurrency = $target.Concurrency
        pace_ms = $target.PaceMs
        successes = $successes
        errors = $errors
        rate_limited = $rateLimited
        expectation_met = if ($target.ExpectRateLimit) { $rateLimited -gt 0 } else { $errors -eq 0 }
        error_rate_pct = [Math]::Round($errors * 100 / $target.Count, 3)
        throughput_rps = [Math]::Round($target.Count / $timer.Elapsed.TotalSeconds, 2)
        mean_ms = [Math]::Round(($latencies | Measure-Object -Average).Average, 2)
        p50_ms = [Math]::Round((Get-Percentile $latencies 0.50), 2)
        p95_ms = [Math]::Round((Get-Percentile $latencies 0.95), 2)
        p99_ms = [Math]::Round((Get-Percentile $latencies 0.99), 2)
        max_ms = [Math]::Round(($latencies | Measure-Object -Maximum).Maximum, 2)
        statuses = $statuses
        first_error = $firstError
    }
}

$report | ConvertTo-Json -Depth 5
if ($failed) { exit 1 }
