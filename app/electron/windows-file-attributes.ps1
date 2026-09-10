# Fixed, read-only metadata operation. All paths arrive as JSON data, not code.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $requestText = [Console]::In.ReadToEnd()
    if ($requestText.Length -gt 4194304) { throw 'Request limit' }
    $request = ConvertFrom-Json -InputObject $requestText
    $root = [string]$request.root
    if (-not [IO.Path]::IsPathRooted($root)) { throw 'Invalid root' }
    $names = @($request.names)
    if ($names.Count -gt 10000) { throw 'Entry limit' }
    $result = New-Object 'System.Collections.Generic.List[object]'
    foreach ($name in $names) {
        if ($name -isnot [string] -or $name.Length -eq 0 -or $name -eq '.' -or $name -eq '..' -or $name -match '[\\/:\x00-\x1f\x7f]') { throw 'Invalid entry' }
        try {
            $attributes = [int][IO.File]::GetAttributes([IO.Path]::Combine($root, $name))
            $result.Add($attributes)
        } catch {
            $result.Add($null)
        }
    }
    [Console]::Out.Write((ConvertTo-Json -InputObject ($result.ToArray()) -Compress))
} catch {
    [Console]::Error.Write('LOCAL_ATTRIBUTES_UNAVAILABLE')
    exit 1
}
