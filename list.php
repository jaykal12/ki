<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
$dir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads';
$urlBase = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['REQUEST_URI']), '/\\') . '/uploads/';
if (!is_dir($dir)) { @mkdir($dir, 0775, true); }

function scanDirectory($dir, $urlBase, $relativePath = '') {
	$items = [];
	if (!is_dir($dir)) return $items;
	
	$dh = opendir($dir);
	if ($dh) {
		while (($file = readdir($dh)) !== false) {
			if ($file === '.' || $file === '..') continue;
			$path = $dir . DIRECTORY_SEPARATOR . $file;
			$relativeFilePath = $relativePath ? $relativePath . '/' . $file : $file;
			
			if (is_file($path)) {
				$mime = function_exists('mime_content_type') ? mime_content_type($path) : 'application/octet-stream';
				$items[] = [
					'name' => $relativeFilePath,
					'size' => filesize($path),
					'type' => $mime,
					'mtime' => filemtime($path) * 1000,
					'url' => $urlBase . rawurlencode($relativeFilePath)
				];
			} elseif (is_dir($path)) {
				// Recursively scan subdirectories
				$subItems = scanDirectory($path, $urlBase, $relativeFilePath);
				$items = array_merge($items, $subItems);
			}
		}
		closedir($dh);
	}
	return $items;
}

$items = scanDirectory($dir, $urlBase);
echo json_encode($items);
