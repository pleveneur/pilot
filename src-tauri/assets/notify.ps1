# Génère et joue un son personnalisé (petite mélodie) pour Magnus
# Usage : powershell -ExecutionPolicy Bypass -File notify.ps1 [type] [volume]
# type : "attention" (défaut) | "point" | "fin"
# volume : 0-100 (défaut 100) — multiplie l'amplitude des notes (0 = muet)
param([string]$type = "attention", [int]$volume = 100)

$sampleRate = 44100
$outFile = Join-Path $PSScriptRoot "notify.wav"

# Amplitude appliquée à toutes les notes (multiplicateur 0-1 sur 32767 * 0.5).
$vol = [Math]::Min(100, [Math]::Max(0, $volume))
$amp = 32767 * 0.5 * ($vol / 100.0)

# Mélodies (fréquences en Hz, durées en ms)
switch ($type) {
  "point"   { $notes = @(@(660,180), @(880,180), @(990,260)) }
  "fin"     { $notes = @(@(523,150), @(659,150), @(784,150), @(1047,300)) }
  default   { $notes = @(@(880,200), @(1175,300)) }
}

# Construire le buffer PCM 16-bit mono
$totalSamples = 0
foreach ($n in $notes) { $totalSamples += [int]($n[1] / 1000 * $sampleRate) }
$buffer = New-Object byte[] ($totalSamples * 2)
$pos = 0
foreach ($n in $notes) {
  $freq = $n[0]; $durSamples = [int]($n[1] / 1000 * $sampleRate)
  for ($i = 0; $i -lt $durSamples; $i++) {
    $t = $i / $sampleRate
    # enveloppe d'atténuation pour éviter les clics
    $env = 1.0 - ($i / $durSamples)
    $val = [int]($amp * $env * [Math]::Sin(2 * [Math]::PI * $freq * $t))
    $buffer[$pos] = $val -band 0xFF
    $buffer[$pos+1] = ($val -shr 8) -band 0xFF
    $pos += 2
  }
}

# Écrire l'en-tête WAV
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("RIFF"))
$bw.Write([int](36 + $buffer.Length))
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("WAVE"))
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("fmt "))
$bw.Write([int]16)
$bw.Write([int16]1)          # PCM
$bw.Write([int16]1)          # mono
$bw.Write([int]$sampleRate)
$bw.Write([int]($sampleRate * 2))
$bw.Write([int16]2)          # block align
$bw.Write([int16]16)         # bits
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("data"))
$bw.Write([int]$buffer.Length)
$bw.Write($buffer)
$bw.Flush()
[System.IO.File]::WriteAllBytes($outFile, $ms.ToArray())

# Jouer le son
$player = New-Object System.Media.SoundPlayer $outFile
$player.PlaySync()
