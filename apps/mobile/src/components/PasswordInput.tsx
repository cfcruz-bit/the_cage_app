import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color } from '@/theme/tokens';

/**
 * Campo de contraseña con el ojo para mostrarla.
 *
 * Escribir a ciegas en un teléfono es donde nacen los "contraseña incorrecta"
 * que no lo son. El ojo deja comprobarla antes de enviar; por defecto sigue
 * oculta.
 *
 * `style` es el del recuadro: el texto y el ojo se colocan dentro.
 */
export const PasswordInput = forwardRef<
  TextInput,
  Omit<TextInputProps, 'secureTextEntry' | 'style'> & { style?: StyleProp<ViewStyle> }
>(function PasswordInput({ style, ...props }, ref) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={[style, styles.box]}>
      <TextInput
        ref={ref}
        {...props}
        secureTextEntry={!visible}
        style={styles.input}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        style={({ pressed }) => [styles.eye, pressed && { opacity: 0.6 }]}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={20}
          color={color.textMuted}
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  // El recuadro conserva el borde y el fondo de quien lo usa; el padding
  // vertical pasa al texto para que el ojo pueda ocupar todo el alto.
  box: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingRight: 0 },
  input: { flex: 1, color: color.text, fontSize: 15, paddingVertical: 13 },
  eye: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
