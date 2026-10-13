param([string]$ProfileId='')
$ErrorActionPreference='Stop'
if($ProfileId -and -not [Guid]::TryParse($ProfileId,[ref]([Guid]::Empty))){throw 'Invalid fixture ID'}
$container=(docker inspect uasspain-e2e-backend-e2e-1 | ConvertFrom-Json)[0]
$pg=(docker inspect uasspain-e2e-postgres-e2e-1 | ConvertFrom-Json)[0]
if($container.Config.Labels.'com.docker.compose.project' -ne 'uasspain-e2e' -or $pg.Config.Labels.'com.docker.compose.project' -ne 'uasspain-e2e'){throw 'Wrong fixture project'}
$platformInfo=$container.ImageManifestDescriptor.platform
$platform=(@($platformInfo.os,$platformInfo.architecture,$platformInfo.variant)|Where-Object{$_}) -join '/'
if(-not $platform){throw 'Missing isolated image platform'}
$platformImage=@(docker image inspect --platform $platform $container.Config.Image|ConvertFrom-Json)[0]
if($LASTEXITCODE -ne 0 -or $platformImage.Descriptor.digest -ne $container.ImageManifestDescriptor.digest){throw 'Isolated running image manifest mismatch'}
$imageReference=@(docker image inspect $container.Config.Image|ConvertFrom-Json)[0].Id
if($LASTEXITCODE -ne 0 -or -not $imageReference){throw 'Cannot resolve isolated image reference'}
$preserved=Get-ChildItem -LiteralPath '.run/e2e-preserved-volumes' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$data=Get-Content -LiteralPath $preserved.FullName -Raw | ConvertFrom-Json
if(-not @($pg.Mounts|Where-Object{$_.Name -eq $data.volumes.e2e_pgdata.name}).Count){throw 'Wrong fixture volume'}
$taskKey=($container.Config.Env|Where-Object{$_.StartsWith('FIELD_ENCRYPTION_KEY=')}).Substring(21)
if([Convert]::FromBase64String($taskKey).Length -ne 32){throw 'Wrong fixture key'}
$override=Join-Path (Resolve-Path '.run/account-lifecycle-20261012') 'essential-fixture-override.json'
$config=@{services=@{'backend-e2e'=@{image=$imageReference;environment=@{ESSENTIAL_ACCOUNT_PROFILE_IDS=$ProfileId}}}}
[IO.File]::WriteAllText($override,($config|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$previous=$env:E2E_FIELD_ENCRYPTION_KEY
try {$env:E2E_FIELD_ENCRYPTION_KEY=$taskKey;& docker compose -p uasspain-e2e -f docker-compose.e2e.yml -f docker-compose.realtime-e2e.yml -f $preserved.FullName -f $override up -d --no-build --no-deps --wait --wait-timeout 120 backend-e2e;if($LASTEXITCODE -ne 0){throw 'Fixture essential setting failed'}}
finally {$env:E2E_FIELD_ENCRYPTION_KEY=$previous;$taskKey=$null}
